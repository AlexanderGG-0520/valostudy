import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { processingOptionsSchema, type ProcessingOptions } from "@valostudy/schema";
const inputOptions = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi", "-probesize", "10000000", "-analyzeduration", "10000000"];
export function runProcess(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false, tooLarge = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > 1024 * 1024) { tooLarge = true; child.kill("SIGKILL"); }
      else stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut || tooLarge || code !== 0)
        reject(new Error(`${binary} failed (code=${code}, timeout=${timedOut}, outputLimit=${tooLarge}): ${stderr}`));
      else resolve(stdout);
    });
  });
}
const metadataSchema = z.object({
  streams: z.array(z.object({ width: z.number().positive(), height: z.number().positive() })).min(1),
  format: z.object({ duration: z.coerce.number().positive().max(28800) }),
});
export async function probe(path: string) {
  const output = await runProcess("ffprobe", ["-v", "error", ...inputOptions, "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration", "-of", "json", path], 30000);
  const data = metadataSchema.parse(JSON.parse(output));
  const { width, height } = data.streams[0];
  if (width * height > 3840 * 2160) throw new Error("Video exceeds 4K pixel limit");
  return { width, height, duration: data.format.duration };
}
export async function extract(path: string, directory: string, options: ProcessingOptions) {
  const o = processingOptionsSchema.parse(options);
  const metadata = await probe(path);
  if (o.startSeconds + o.durationSeconds > metadata.duration + 0.05) throw new Error("Requested segment exceeds video duration");
  await runProcess("ffmpeg", ["-nostdin", "-v", "error", "-threads", "2", ...inputOptions,
    "-ss", String(o.startSeconds), "-i", path, "-t", String(o.durationSeconds),
    "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", `fps=${o.fps},scale=w='min(1920,iw)':h=-2`,
    "-c:v", "libwebp", "-threads", "2", "-frames:v", "300", "-q:v", "80", "-n", join(directory, "%06d.webp")], 300000);
  const names = (await readdir(directory)).filter((name) => /^[0-9]{6}\.webp$/.test(name)).sort();
  if (!names.length) throw new Error("No frames extracted");
  return { metadata, frames: names.map((name, i) => ({ name, timestampMs: Math.round((o.startSeconds + i / o.fps) * 1000) })) };
}
