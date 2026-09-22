import { it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProcess, probe, extract } from "../apps/worker/src/media";

it("probes and extracts the entire real video into full-resolution 4:4:4 JPEG frames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "valostudy-test-"));
  const previousProcesses = process.env.WORKER_FFMPEG_PROCESSES;
  const previousThreads = process.env.WORKER_FFMPEG_THREADS;
  process.env.WORKER_FFMPEG_PROCESSES = "8";
  process.env.WORKER_FFMPEG_THREADS = "8";
  try {
    const source = join(dir, "fixture.mp4");
    const output = join(dir, "frames");
    await mkdir(output);
    await runProcess(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-t", "3", "-c:v", "mpeg4", source],
      10000,
    );

    expect(await probe(source)).toEqual({ width: 320, height: 240, duration: 3 });
    const progress: number[] = [];
    const result = await extract(source, output, { fps: 2 }, undefined, ({ percent }) => {
      progress.push(percent);
    });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(result.schema).toBe("valostudy.vcmr");
    expect(result.schemaVersion).toBe("1.1.0");
    expect(result.media).toEqual({
      width: 320,
      height: 240,
      durationMs: 3000,
      sampling: {
        fps: 2,
        strategy: "fixed_rate",
        timestampSemantics: "Sampling timeline; timestamps are approximate, not original frame PTS.",
      },
    });
    expect(result.timeline).toEqual({
      origin: "video_start",
      unit: "ms",
      frameOrdering: "sample_index",
      durationMs: 3000,
      samplingIntervalMs: 500,
      frameCount: 6,
      observedRange: { startMs: 0, endMs: 2500 },
      coverage: { expectedFrameCount: 6, observedFrameCount: 6, complete: true },
    });
    expect(result.rounds).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.annotations).toEqual([]);
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(result.frames[0]).toMatchObject({
      id: "frame_000001",
      name: "000001.jpg",
      sampleIndex: 0,
      source: { kind: "fixed_rate_sampling", approximateTimestamp: true },
    });
    const firstFrame = join(output, result.frames[0].name);
    expect(Array.from((await readFile(firstFrame)).subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    const frameMetadata = JSON.parse(await runProcess(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "json", firstFrame],
      10000,
    ));
    expect(frameMetadata.streams[0]).toMatchObject({ width: 320, height: 240, pix_fmt: "yuvj444p" });

    const bad = join(dir, "fake.mp4");
    await writeFile(bad, "not a video");
    await expect(probe(bad)).rejects.toThrow("ffprobe failed");
  } finally {
    if (previousProcesses === undefined) delete process.env.WORKER_FFMPEG_PROCESSES;
    else process.env.WORKER_FFMPEG_PROCESSES = previousProcesses;
    if (previousThreads === undefined) delete process.env.WORKER_FFMPEG_THREADS;
    else process.env.WORKER_FFMPEG_THREADS = previousThreads;
    await rm(dir, { recursive: true, force: true });
  }
});

it("captures process errors, timeouts and missing executables", async () => {
  await expect(
    runProcess(process.execPath, ["-e", "process.stderr.write('diagnostic');process.exit(3)"], 1000),
  ).rejects.toThrow("diagnostic");
  await expect(runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], 50)).rejects.toThrow("timeout=true");
  await expect(runProcess("valostudy-missing-binary", [], 1000)).rejects.toThrow();
});
