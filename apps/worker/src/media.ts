import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { workerTuning } from "@valostudy/config";
import {
  MAX_EXTRACTED_FRAMES,
  MAX_VIDEO_SECONDS,
  processingOptionsSchema,
  vcmrExtractionSchema,
  VCMR_SCHEMA,
  VCMR_SCHEMA_VERSION,
  VCMR_TIMESTAMP_SEMANTICS,
  type ProcessingOptions,
} from "@valostudy/schema";

const inputOptions = [
  "-protocol_whitelist", "file,pipe",
  "-format_whitelist", "mov,matroska,webm,avi",
  "-probesize", "10000000",
  "-analyzeduration", "10000000",
];

export function runProcess(
  binary: string,
  args: string[],
  timeoutMs: number,
  onStdout?: (chunk: string) => void | Promise<void>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false, tooLarge = false;
    let handlerError: unknown;
    let handlerChain = Promise.resolve();
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (onStdout) {
        handlerChain = handlerChain
          .then(async () => {
            if (handlerError) return;
            await onStdout(text);
          })
          .catch((error) => {
            handlerError = error;
            child.kill("SIGKILL");
          });
      } else if (stdout.length + chunk.length > 1024 * 1024) {
        tooLarge = true;
        child.kill("SIGKILL");
      } else {
        stdout += text;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      void handlerChain.then(() => {
        if (handlerError) reject(handlerError);
        else if (timedOut || tooLarge || code !== 0)
          reject(new Error(`${binary} failed (code=${code}, timeout=${timedOut}, outputLimit=${tooLarge}): ${stderr}`));
        else resolve(stdout);
      });
    });
  });
}

const metadataSchema = z.object({
  streams: z.array(z.object({ width: z.number().positive(), height: z.number().positive() })).min(1),
  format: z.object({ duration: z.coerce.number().positive().max(MAX_VIDEO_SECONDS) }),
});

export async function probe(path: string, maxVideoSeconds = MAX_VIDEO_SECONDS) {
  const output = await runProcess("ffprobe", [
    "-v", "error", ...inputOptions, "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration", "-of", "json", path,
  ], 60000);
  const data = metadataSchema.parse(JSON.parse(output));
  const { width, height } = data.streams[0];
  if (width * height > 3840 * 2160) throw new Error("Video exceeds 4K pixel limit");
  if (data.format.duration > maxVideoSeconds)
    throw new Error(`Video exceeds plan duration limit of ${maxVideoSeconds} seconds`);
  return { width, height, duration: data.format.duration };
}

export async function extract(
  path: string,
  directory: string,
  options: ProcessingOptions,
  limits: { maxVideoSeconds: number; maxFrames: number } = {
    maxVideoSeconds: MAX_VIDEO_SECONDS,
    maxFrames: MAX_EXTRACTED_FRAMES,
  },
  onProgress?: (progress: {
    percent: number;
    processedSeconds: number;
    durationSeconds: number;
    expectedFrames: number;
  }) => void | Promise<void>,
) {
  const o = processingOptionsSchema.parse(options);
  const metadata = await probe(path, limits.maxVideoSeconds);
  const expectedFrames = Math.ceil(metadata.duration * o.fps);
  if (expectedFrames > limits.maxFrames)
    throw new Error(`Full-match extraction would exceed plan limit of ${limits.maxFrames} frames; choose a lower sampling rate`);

  // Each extractor handles a disjoint, frame-aligned segment. JPEG encoding is
  // deliberately full-resolution and 4:4:4 to preserve crosshair/HUD detail.
  const tuning = workerTuning();
  const processCount = Math.min(tuning.WORKER_FFMPEG_PROCESSES, expectedFrames);
  const threadsPerProcess = Math.max(1, Math.floor(tuning.WORKER_FFMPEG_THREADS / processCount));
  const framesPerProcess = Math.ceil(expectedFrames / processCount);
  const chunks = Array.from({ length: processCount }, (_, index) => {
    const startFrame = index * framesPerProcess;
    const frameCount = Math.min(framesPerProcess, expectedFrames - startFrame);
    return {
      index,
      startFrame,
      frameCount,
      startSeconds: startFrame / o.fps,
    };
  }).filter((chunk) => chunk.frameCount > 0);

  const ffmpegTimeoutMs = Math.min(
    6 * 60 * 60 * 1000,
    Math.max(30 * 60 * 1000, Math.ceil(metadata.duration * 2 * 1000)),
  );

  const completedByChunk = new Array(chunks.length).fill(0);
  let lastReportedPercent = -1;

  const reportProgress = async (chunkIndex: number, localFrames: number) => {
    completedByChunk[chunkIndex] = Math.max(
      completedByChunk[chunkIndex],
      Math.min(chunks[chunkIndex].frameCount, localFrames),
    );
    const processedFrames = completedByChunk.reduce((sum, value) => sum + value, 0);
    const percent = Math.min(100, Math.floor((processedFrames / expectedFrames) * 100));
    if (percent <= lastReportedPercent) return;
    lastReportedPercent = percent;
    await onProgress?.({
      percent,
      processedSeconds: Math.min(metadata.duration, processedFrames / o.fps),
      durationSeconds: metadata.duration,
      expectedFrames,
    });
  };

  await Promise.all(chunks.map(async (chunk) => {
    let progressBuffer = "";
    await runProcess("ffmpeg", [
      "-nostdin", "-v", "error",
      "-threads", String(threadsPerProcess),
      "-filter_threads", String(threadsPerProcess),
      ...inputOptions,
      "-ss", chunk.startSeconds.toFixed(6),
      "-i", path,
      "-map", "0:v:0", "-an", "-sn", "-dn",
      "-vf", `fps=${o.fps}`,
      "-c:v", "mjpeg",
      "-threads", String(threadsPerProcess),
      "-pix_fmt", "yuvj444p",
      "-q:v", "2",
      "-frames:v", String(chunk.frameCount),
      "-start_number", String(chunk.startFrame + 1),
      "-progress", "pipe:1", "-nostats",
      "-n", join(directory, "%06d.jpg"),
    ], ffmpegTimeoutMs, async (stdoutChunk) => {
      progressBuffer += stdoutChunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0 || line.slice(0, separator) !== "frame") continue;
        const localFrames = Number(line.slice(separator + 1));
        if (!Number.isFinite(localFrames)) continue;
        await reportProgress(chunk.index, localFrames);
      }
    });
    await reportProgress(chunk.index, chunk.frameCount);
  }));

  if (lastReportedPercent < 100) {
    await onProgress?.({
      percent: 100,
      processedSeconds: metadata.duration,
      durationSeconds: metadata.duration,
      expectedFrames,
    });
  }

  const names = (await readdir(directory)).filter((name) => /^[0-9]{6}\.jpg$/.test(name)).sort();
  if (!names.length) throw new Error("No frames extracted");
  return vcmrExtractionSchema.parse({
    schema: VCMR_SCHEMA,
    schemaVersion: VCMR_SCHEMA_VERSION,
    media: {
      width: metadata.width,
      height: metadata.height,
      durationMs: Math.round(metadata.duration * 1000),
      sampling: {
        fps: o.fps,
        strategy: "fixed_rate",
        timestampSemantics: VCMR_TIMESTAMP_SEMANTICS,
      },
    },
    frames: names.map((name) => ({
      id: `frame_${name.slice(0, 6)}`,
      name,
      timestampMs: Math.round(((Number.parseInt(name.slice(0, 6), 10) - 1) / o.fps) * 1000),
      source: {
        kind: "fixed_rate_sampling",
        approximateTimestamp: true,
      },
    })),
    rounds: [],
    events: [],
    annotations: [],
  });
}
