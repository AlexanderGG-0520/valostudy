import { Queue, Worker } from "bullmq";
import { db, jobs, studies, uploads, frames, usageEvents, eq, inArray, and, isNull, sql } from "@valostudy/db";
import { PLAN_LIMITS } from "@valostudy/schema";
import { config, redisConnection, QUEUE_NAME, log } from "@valostudy/config";
import { Storage } from "@valostudy/storage";
import { processVideo } from "./process";

config();

const queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
const worker = new Worker(QUEUE_NAME, processVideo, {
  connection: redisConnection(),
  concurrency: 1,
  maxStalledCount: 1,
});

worker.on("error", (e) => log("worker_error", { reason: e.message }));
queue.on("error", (e) => log("queue_error", { reason: e.message }));

async function reconcile() {
  const rows = await db().select({ job: jobs, study: studies, upload: uploads }).from(jobs)
    .innerJoin(studies, eq(studies.id, jobs.studyId))
    .innerJoin(uploads, eq(uploads.studyId, jobs.studyId))
    .where(inArray(jobs.status, ["pending", "queued", "processing"]));

  for (const { job, study, upload } of rows) {
    const queued = await queue.getJob(study.id);
    const state = await queued?.getState();

    if (state === "failed" || (state === "completed" && study.status !== "completed")) {
      await db().transaction(async (tx) => {
        await tx.update(jobs).set({
          status: "failed",
          error: "Queue failed or processing was interrupted",
          updatedAt: new Date(),
        }).where(and(eq(jobs.studyId, study.id), inArray(jobs.status, ["pending", "queued", "processing"])));
        await tx.update(studies).set({ status: "failed" })
          .where(and(eq(studies.id, study.id), inArray(studies.status, ["queued", "processing"])));
        await tx.update(usageEvents).set({ releasedAt: new Date() }).where(and(
          eq(usageEvents.studyId, study.id),
          isNull(usageEvents.releasedAt),
        ));
      });
      try {
        await new Storage().delete(upload.objectKey);
        log("source_discarded", { studyId: study.id, stage: "reconcile_failed_job" });
      } catch (e) {
        log("source_discard_failed", {
          studyId: study.id,
          stage: "reconcile_failed_job",
          reason: e instanceof Error ? e.message : "Unknown",
        });
      }
    } else if (!queued) {
      await db().update(jobs).set({ status: "queued", updatedAt: new Date() })
        .where(and(eq(jobs.studyId, job.studyId), eq(jobs.status, "pending")));
      await queue.add("extract", {
        studyId: study.id,
        sourceObjectKey: upload.objectKey,
        options: study.options,
      }, {
        jobId: study.id,
        attempts: 3,
        priority: PLAN_LIMITS[study.plan].queuePriority,
        backoff: { type: "exponential", delay: 5000 },
      });
    }
  }

  const expiredUploads = await db().select().from(uploads)
    .where(sql`${uploads.completedAt} is null and ${uploads.expiresAt} < now()`).limit(50);

  for (const upload of expiredUploads) {
    await db().transaction(async (tx) => {
      const [current] = await tx.select().from(uploads)
        .where(eq(uploads.studyId, upload.studyId)).for("update");
      if (!current || current.completedAt) return;
      const storage = new Storage();
      try {
        await storage.abort(current.objectKey, current.uploadId);
      } catch (e) {
        if (!(e instanceof Error && e.name === "NoSuchUpload")) throw e;
      }
      await storage.delete(current.objectKey);
      await tx.delete(uploads).where(eq(uploads.studyId, current.studyId));
      await tx.update(studies).set({ status: "failed" }).where(eq(studies.id, current.studyId));
    });
  }

  const expiredStudies = await db().select().from(studies).where(sql`
    ${studies.status} = 'completed'
    and ${studies.retentionUntil} is not null
    and ${studies.retentionUntil} < now()
    and ${studies.framesExpiredAt} is null
  `).limit(10);

  for (const study of expiredStudies) {
    const storedFrames = await db().select().from(frames).where(eq(frames.studyId, study.id));
    await new Storage().deleteMany(storedFrames.map((frame) => frame.objectKey));
    await db().transaction(async (tx) => {
      await tx.delete(frames).where(eq(frames.studyId, study.id));
      await tx.update(studies).set({ framesExpiredAt: new Date() }).where(eq(studies.id, study.id));
    });
    log("frames_expired", { studyId: study.id, frameCount: storedFrames.length, plan: study.plan });
  }
}

let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function tick() {
  try {
    await reconcile();
  } catch (e) {
    log("reconcile_failed", { reason: e instanceof Error ? e.message : "Unknown" });
  }
  if (!stopping) timer = setTimeout(tick, 10000);
}

void tick();

async function shutdown() {
  stopping = true;
  if (timer) clearTimeout(timer);
  await worker.close();
  await queue.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
log("worker_ready", { stage: "waiting" });
