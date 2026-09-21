import { it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProcess, probe, extract } from "../apps/worker/src/media";
it("probes and extracts a real video into timestamped WebP frames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "valostudy-test-"));
  try {
    const source = join(dir, "fixture.mp4"), output = join(dir, "frames");
    await mkdir(output);
    await runProcess("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-t", "3", "-c:v", "mpeg4", source], 10000);
    expect(await probe(source)).toEqual({ width: 320, height: 240, duration: 3 });
    const result = await extract(source, output, { startSeconds: 0.5, durationSeconds: 2, fps: 2 });
    expect(result.frames.map((f) => f.timestampMs)).toEqual([500, 1000, 1500, 2000]);
    expect(result.frames[0].name).toBe("000001.webp");
    expect((await readFile(join(output, result.frames[0].name))).subarray(8, 12).toString()).toBe("WEBP");
    await expect(extract(source, output, { startSeconds: 2, durationSeconds: 2, fps: 2 })).rejects.toThrow("exceeds video");
    const bad = join(dir, "fake.mp4");
    await writeFile(bad, "not a video");
    await expect(probe(bad)).rejects.toThrow("ffprobe failed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("captures process errors, timeouts and missing executables", async () => {
  await expect(runProcess(process.execPath, ["-e", "process.stderr.write('diagnostic');process.exit(3)"], 1000)).rejects.toThrow("diagnostic");
  await expect(runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], 50)).rejects.toThrow("timeout=true");
  await expect(runProcess("valostudy-missing-binary", [], 1000)).rejects.toThrow();
});
