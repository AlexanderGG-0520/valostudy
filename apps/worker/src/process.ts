import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Job } from "bullmq";
import { db, studies, jobs, uploads, frames, usageEvents, eq, and, inArray, isNull } from "@valostudy/db";
import { PLAN_LIMITS, processingJobSchema, type ProcessingProgress } from "@valostudy/schema";
import { Storage, frameKey, sourceKey } from "@valostudy/storage";
import { log, workerTuning } from "@valostudy/config";
import { extract } from "./media";

const DAY = 24 * 60 * 60 * 1000;
const FRAME_DB_BATCH_SIZE = 1000;

async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  let firstError: unknown;

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      for (;;) {
        if (firstError) return;
        const index = nextIndex++;
        if (index >= items.length) return;
        try {
          await task(items[index]);
        } catch (error) {
          firstError ??= error;
          return;
        }
      }
    },
  ));

  if (firstError) throw firstError;
}

export async function processVideo(job: Pick<Job, "data" | "id" | "attemptsMade" | "opts">) {
  const payload = processingJobSchema.parse(job.data);
  const id = payload.studyId;
  const [study] = await db().select().from(studies).where(eq(studies.id, id));
  const [upload] = await db().select().from(uploads).where(eq(uploads.studyId, id));
  if (!study || !upload?.completedAt || upload.objectKey !== sourceKey(id)) throw new Error("Invalid processing source");

  const limits = PLAN_LIMITS[study.plan];
  const storage = new Storage();

  if (study.status === "completed") {
    await storage.delete(upload.objectKey);
    log("source_discarded", { studyId: id, jobId: job.id, stage: "discard_source", reason: "completed_retry" });
    return;
  }

  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  let stage = "download";
  let directory: string | undefined;

  const setProgress = async (progress: Omit<ProcessingProgress, "startedAt">) => {
    await db().update(jobs).set({
      progress: { ...progress, startedAt },
      updatedAt: new Date(),
    }).where(eq(jobs.studyId, id));
  };

  try {
    await db().transaction(async (tx) => {
      await tx.update(studies).set({ status: "processing" }).where(eq(studies.id, id));
      await tx.update(jobs).set({
        status: "processing",
        attempts: job.attemptsMade + 1,
        error: null,
        progress: { stage: "download", percent: 5, processedFrames: null, totalFrames: null, startedAt },
        updatedAt: new Date(),
      }).where(eq(jobs.studyId, id));
    });
    log("processing_started", { studyId: id, jobId: job.id, stage, retryCount: job.attemptsMade, plan: study.plan });

    directory = await mkdtemp(join(tmpdir(), "valostudy-"));
    const source = join(directory, "source");
    const output = join(directory, "frames");
    await mkdir(output);

    const object = await storage.get(upload.objectKey);
    if (!object.Body || object.ContentLength !== upload.expectedBytes) throw new Error("Source size mismatch");
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > limits.maxUploadBytes || bytes > upload.expectedBytes
          ? new Error("Source exceeds plan byte limit")
          : null, chunk);
      },
    });

    const reader = object.Body.transformToWebStream().getReader();
    async function* chunks() {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }

    await pipeline(
      Readable.from(chunks()),
      limit,
      createWriteStream(source),
      { signal: AbortSignal.timeout(2 * 60 * 60 * 1000) },
    );
    if (bytes !== upload.expectedBytes) throw new Error("Truncated source");
    await setProgress({ stage: "download", percent: 15, processedFrames: null, totalFrames: null });

    stage = "ffmpeg";
    const ffmpegStarted = Date.now();
    const result = await extract(source, output, study.options, {
      maxVideoSeconds: limits.maxVideoSeconds,
      maxFrames: limits.maxFrames,
    }, async (progress) => {
      const weightedPercent = Math.min(75, 15 + Math.floor(progress.percent * 0.6));
      const processedFrames = Math.min(
        progress.expectedFrames,
        Math.floor((progress.expectedFrames * progress.percent) / 100),
      );
      await setProgress({
        stage: "extract",
        percent: weightedPercent,
        processedFrames,
        totalFrames: progress.expectedFrames,
      });
    });
    const ffmpegDurationMs = Date.now() - ffmpegStarted;
    log("frames_extracted", {
      studyId: id,
      jobId: job.id,
      stage,
      duration: ffmpegDurationMs,
      frameCount: result.frames.length,
      framesPerSecond: ffmpegDurationMs > 0
        ? Number((result.frames.length / (ffmpegDurationMs / 1000)).toFixed(2))
        : null,
      ffmpegProcesses: workerTuning().WORKER_FFMPEG_PROCESSES,
      ffmpegThreads: workerTuning().WORKER_FFMPEG_THREADS,
    });

    stage = "persist";
    const persistStarted = Date.now();
    const frameUploadConcurrency = workerTuning().WORKER_FRAME_UPLOAD_CONCURRENCY;
    const rows: (typeof frames.$inferInsert)[] = result.frames.map((frame) => ({
      ...frame,
      studyId: id,
      objectKey: frameKey(id, frame.name),
    }));

    let uploadedFrames = 0;
    let nextPersistReport = 1;
    await setProgress({ stage: "persist", percent: 75, processedFrames: 0, totalFrames: rows.length });
    await forEachConcurrent(rows, frameUploadConcurrency, async (frame) => {
      await storage.putFrame(frame.objectKey, await readFile(join(output, frame.name)));
      uploadedFrames += 1;
      const persistPercent = Math.min(98, 75 + Math.floor((uploadedFrames / rows.length) * 23));
      if (persistPercent >= nextPersistReport || uploadedFrames === rows.length) {
        nextPersistReport = persistPercent + 1;
        await setProgress({
          stage: "persist",
          percent: persistPercent,
          processedFrames: uploadedFrames,
          totalFrames: rows.length,
        });
      }
    });

    log("frames_persisted", {
      studyId: id,
      jobId: job.id,
      stage,
      duration: Date.now() - persistStarted,
      frameCount: rows.length,
      concurrency: frameUploadConcurrency,
    });

    await setProgress({ stage: "finalize", percent: 99, processedFrames: rows.length, totalFrames: rows.length });
    const completedAt = new Date();
    const retentionUntil = limits.retentionDays === null
      ? null
      : new Date(completedAt.getTime() + limits.retentionDays * DAY);

    await db().transaction(async (tx) => {
      await tx.delete(frames).where(eq(frames.studyId, id));
      for (let offset = 0; offset < rows.length; offset += FRAME_DB_BATCH_SIZE) {
        await tx.insert(frames).values(rows.slice(offset, offset + FRAME_DB_BATCH_SIZE));
      }
      await tx.update(uploads).set({ metadata: result.metadata }).where(eq(uploads.studyId, id));
      await tx.update(studies).set({
        status: "completed",
        completedAt,
        retentionUntil,
        framesExpiredAt: null,
      }).where(eq(studies.id, id));
      await tx.update(jobs).set({
        status: "completed",
        error: null,
        progress: {
          stage: "completed",
          percent: 100,
          processedFrames: rows.length,
          totalFrames: rows.length,
          startedAt,
        },
        updatedAt: completedAt,
      }).where(eq(jobs.studyId, id));
    });

    stage = "discard_source";
    await storage.delete(upload.objectKey);
    log("source_discarded", { studyId: id, jobId: job.id, stage });

    log("processing_completed", {
      studyId: id,
      jobId: job.id,
      stage,
      duration: Date.now() - started,
      frameCount: rows.length,
      plan: study.plan,
    });
  } catch (e) {
    const status = job.attemptsMade + 1 < (job.opts.attempts ?? 1) ? "queued" : "failed";
    await db().transaction(async (tx) => {
      await tx.update(studies).set({ status }).where(and(
        eq(studies.id, id),
        inArray(studies.status, ["queued", "processing", "failed"]),
      ));
      await tx.update(jobs).set({
        status,
        error: "Video processing failed; see worker logs",
        progress: status === "failed"
          ? { stage: "failed", percent: 0, processedFrames: null, totalFrames: null, startedAt }
          : { stage: "queued", percent: 0, processedFrames: null, totalFrames: null, startedAt: null },
        updatedAt: new Date(),
      }).where(and(
        eq(jobs.studyId, id),
        inArray(jobs.status, ["pending", "queued", "processing", "failed"]),
      ));
      if (status === "failed") {
        await tx.update(usageEvents).set({ releasedAt: new Date() }).where(and(
          eq(usageEvents.studyId, id),
          isNull(usageEvents.releasedAt),
        ));
      }
    });

    if (status === "failed") {
      try {
        await storage.delete(upload.objectKey);
        log("source_discarded", { studyId: id, jobId: job.id, stage: "discard_source", reason: "terminal_failure" });
      } catch (cleanupError) {
        log("source_discard_failed", {
          studyId: id,
          jobId: job.id,
          stage: "discard_source",
          reason: cleanupError instanceof Error ? cleanupError.message : "Unknown",
        });
      }
    }

    log("processing_failed", {
      studyId: id,
      jobId: job.id,
      stage,
      duration: Date.now() - started,
      reason: e instanceof Error ? e.message : "Unknown",
    });
    throw e;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
