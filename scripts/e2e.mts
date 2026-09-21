import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, appendFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { S3Client, CreateBucketCommand, ListBucketsCommand } from "@aws-sdk/client-s3";

const runId = randomBytes(8).toString("hex");
const project = "valostudy-e2e-" + runId;
const scratch = await mkdtemp(join(tmpdir(), project + "-"));
const artifacts = resolve(".e2e-artifacts", runId);
await mkdir(artifacts, { recursive: true });
const children: ChildProcess[] = [];
const logWrites: Promise<void>[] = [];
let shuttingDown = false;
let composeStarted = false;
let failed = false;
async function freePort() {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing allocated port");
  await new Promise<void>((done, reject) => server.close((e) => e ? reject(e) : done()));
  return String(address.port);
}
const [pgPort, valkeyPort, s3Port, webPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
const password = randomBytes(24).toString("hex");
const env = {
  ...process.env,
  E2E_RUN_ID: runId, E2E_ARTIFACT_DIR: artifacts,
  E2E_VIDEO: join(scratch, "fixture.avi"),
  E2E_PG_PORT: pgPort, E2E_VALKEY_PORT: valkeyPort, E2E_S3_PORT: s3Port,
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://valostudy_e2e:${password}@127.0.0.1:${pgPort}/valostudy_e2e`,
  REDIS_URL: `redis://127.0.0.1:${valkeyPort}`,
  BETTER_AUTH_URL: `http://127.0.0.1:${webPort}`,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  S3_ENDPOINT: `http://127.0.0.1:${s3Port}`,
  S3_REGION: "us-east-1", S3_BUCKET: "valostudy-e2e-" + runId,
  S3_ACCESS_KEY: "e2e-" + runId, S3_SECRET_KEY: randomBytes(24).toString("hex"),
  HOSTNAME: "127.0.0.1", PORT: webPort, NEXT_TELEMETRY_DISABLED: "1",
};
function redact(text: string) {
  for (const secret of [env.POSTGRES_PASSWORD, env.BETTER_AUTH_SECRET, env.S3_SECRET_KEY, env.S3_ACCESS_KEY])
    text = text.replaceAll(secret, "[redacted]");
  return text;
}
function start(label: string, command: string, args: string[]) {
  const child = spawn(command, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const log = (data: Buffer) => {
    const text = redact(data.toString());
    logWrites.push(appendFile(join(artifacts, label + ".log"), text));
    if (label === "playwright") process.stdout.write(text);
  };
  child.stdout?.on("data", log);
  child.stderr?.on("data", log);
  return child;
}
async function command(label: string, binary: string, args: string[]) {
  const child = start(label, binary, args);
  await new Promise<void>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`${label} exited ${code ?? signal}; see ${artifacts}/${label}.log`)));
  });
}
const composeArgs = ["compose", "-p", project, "-f", "infra/docker/e2e.compose.yaml"];
async function until(label: string, probe: () => Promise<boolean>, processes: ChildProcess[] = []) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (processes.some((p) => p.exitCode !== null || p.signalCode !== null)) throw new Error(label + " process exited");
    try { if (await probe()) return; } catch { /* Dependency may still be starting. */ }
    await delay(500);
  }
  throw new Error(label + " readiness timed out");
}
async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...children].reverse()) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    const pid = child.pid;
    const closed = new Promise<void>((done) => child.once("exit", () => done()));
    try { process.kill(-pid, "SIGTERM"); } catch { continue; }
    await Promise.race([closed, delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* Already stopped. */ }
      await closed;
    }
  }
  try {
    if (composeStarted) {
      if (failed) await command("services", "docker", [...composeArgs, "logs", "--no-color"]).catch(() => undefined);
      // The project name is random and belongs solely to this run; no dev services/volumes are touched.
      await command("cleanup", "docker", [...composeArgs, "down", "--volumes", "--remove-orphans", "--timeout", "5"]);
    }
  } finally {
    await Promise.allSettled(logWrites);
    await rm(scratch, { recursive: true, force: true });
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  failed = true;
  void cleanup().finally(() => process.exit(130));
});
try {
  await command("docker-version", "docker", ["compose", "version"]);
  await command("docker-info", "docker", ["info", "--format", "{{.ServerVersion}}"]);
  await access("apps/web/.next/standalone/apps/web/server.js");
  await access("apps/worker/dist/index.js");
  composeStarted = true;
  await command("services-start", "docker", [...composeArgs, "up", "-d", "--wait", "--wait-timeout", "90"]);
  const client = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 3 });
  try { await until("PostgreSQL", async () => { await client`select 1`; return true; }); }
  finally { await client.end(); }
  const storage = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
  try {
    await until("MinIO", async () => { await storage.send(new ListBucketsCommand({})); return true; });
    await storage.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  } finally { storage.destroy(); }
  // Applying twice checks migration idempotency on real PostgreSQL.
  await command("migrate", "pnpm", ["db:migrate"]);
  await command("migrate-again", "pnpm", ["db:migrate"]);
  await command("fixture", "ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
    "-t", "3", "-c:v", "rawvideo", "-pix_fmt", "bgr24", env.E2E_VIDEO]);
  const web = start("web", process.execPath, ["apps/web/.next/standalone/apps/web/server.js"]);
  await until("Web", async () => (await fetch(env.BETTER_AUTH_URL + "/api/health", { signal: AbortSignal.timeout(3000) })).ok, [web]);
  const worker = start("worker", process.execPath, ["--import", "tsx", "apps/worker/dist/index.js"]);
  worker.once("error", (e) => { console.error(e.message); });
  await command("playwright", "pnpm", ["exec", "playwright", "test"]);
  console.log("Real-service E2E passed. Artifacts: " + artifacts);
} catch (e) {
  failed = true;
  console.error(redact(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
} finally {
  await cleanup().catch((e: unknown) => { console.error("Cleanup failed:", e); process.exitCode = 1; });
}
