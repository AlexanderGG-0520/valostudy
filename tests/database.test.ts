import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { input } from "./fixtures";
const state = vi.hoisted(() => ({
  database: undefined as unknown,
  create: vi.fn(), abort: vi.fn(), head: vi.fn(), parts: vi.fn(), complete: vi.fn(), delete: vi.fn(),
  get: vi.fn(), putFrame: vi.fn(), getSession: vi.fn(),
}));
vi.mock("@valostudy/db", async (original) => ({
  ...await original<typeof import("@valostudy/db")>(), db: () => state.database,
}));
vi.mock("@valostudy/storage", async (original) => ({
  ...await original<typeof import("@valostudy/storage")>(),
  Storage: class {
    create = state.create; abort = state.abort; head = state.head; parts = state.parts;
    complete = state.complete; delete = state.delete;
    get = state.get; putFrame = state.putFrame;
  },
}));
vi.mock("../apps/web/lib/auth", () => ({ auth: () => ({ api: { getSession: state.getSession } }) }));
import { createStudy, readableStudy, buildManifest, enqueueCompletedUpload, ownedUpload } from "../apps/web/lib/studies";
import { processVideo } from "../apps/worker/src/process";
import { runProcess } from "../apps/worker/src/media";
import { GET as frameGET } from "../apps/web/app/[id]/frames/[name]/route";
import * as schema from "@valostudy/db/schema";
import { eq } from "drizzle-orm";
let pg: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async () => {
  pg = new PGlite();
  const directory = new URL("../packages/db/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(file, directory), "utf8"));
  database = drizzle(pg, { schema });
  state.database = database;
}, 30000);
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec("TRUNCATE users, studies, prompt_templates CASCADE");
  await database.insert(schema.user).values({ id: "owner", name: "Player", email: "player@example.test" });
  vi.resetAllMocks();
  state.create.mockResolvedValue("storage-upload-id");
  state.abort.mockResolvedValue({});
  state.head.mockResolvedValue(null);
  state.parts.mockResolvedValue([{ PartNumber: 1, ETag: "etag", Size: input.video.size }]);
  state.complete.mockResolvedValue({});
});
it("migrates real SQL, creates Study + snapshot, and enforces private ownership", async () => {
  const study = await createStudy("owner", { ...input, visibility: "private" });
  expect(study.id).toMatch(/^[0-9a-f]{11}$/);
  expect(await readableStudy(study.id)).toBeNull();
  expect(await readableStudy(study.id, "other")).toBeNull();
  expect(await readableStudy(study.id, "owner")).toMatchObject({ id: study.id });
  await expect(buildManifest(study.id)).rejects.toMatchObject({ status: 404 });
  const m = await buildManifest(study.id, "owner");
  expect(m.prompt).toContain("Platinum 3");
  expect(m.frames).toEqual([]);
  await expect(ownedUpload(study.id, "other")).rejects.toMatchObject({ status: 404 });
});
it("serves a public manifest with stable prompt snapshots", async () => {
  const study = await createStudy("owner", input);
  const first = await buildManifest(study.id);
  await database.update(schema.promptTemplates).set({ coachingPrompt: "Future template text" });
  expect((await buildManifest(study.id)).prompt).toBe(first.prompt);
  await database.insert(schema.frames).values({ studyId: study.id, name: "000001.webp", objectKey: "internal/never-expose", timestampMs: 500 });
  await database.update(schema.studies).set({ status: "completed" }).where(eq(schema.studies.id, study.id));
  const completed = await buildManifest(study.id);
  expect(completed.frames[0].url).toBe(`/${study.id}/frames/000001.webp`);
  expect(JSON.stringify(completed)).not.toContain("internal/never-expose");
});
it("enforces Study ID format and uniqueness in PostgreSQL", async () => {
  const study = await createStudy("owner", input);
  await expect(database.insert(schema.studies).values({ ...study, id: "1234567890abcdef" })).rejects.toThrow();
  await expect(database.insert(schema.studies).values(study)).rejects.toThrow();
});
it("completes multipart exactly once and persists a durable queue outbox", async () => {
  const study = await createStudy("owner", input);
  state.head.mockResolvedValueOnce(null).mockResolvedValue({ ContentLength: input.video.size });
  await enqueueCompletedUpload(study.id, "owner");
  await enqueueCompletedUpload(study.id, "owner");
  expect(state.complete).toHaveBeenCalledTimes(1);
  expect(await database.select().from(schema.jobs)).toMatchObject([{ studyId: study.id, status: "pending" }]);
  expect((await readableStudy(study.id))?.status).toBe("queued");
});
it("recovers from a crash after S3 completed but before PostgreSQL committed", async () => {
  const study = await createStudy("owner", input);
  state.head.mockResolvedValue({ ContentLength: input.video.size });
  await enqueueCompletedUpload(study.id, "owner");
  expect(state.complete).not.toHaveBeenCalled();
  expect(await database.select().from(schema.jobs)).toHaveLength(1);
});
it("rejects missing parts, wrong sizes, expired sessions and wrong owners", async () => {
  const study = await createStudy("owner", input);
  await expect(enqueueCompletedUpload(study.id, "other")).rejects.toMatchObject({ status: 404 });
  state.parts.mockResolvedValue([{ PartNumber: 1, ETag: "etag", Size: 1 }]);
  await expect(enqueueCompletedUpload(study.id, "owner")).rejects.toMatchObject({ status: 400 });
  expect(state.complete).not.toHaveBeenCalled();
  expect(await database.select().from(schema.jobs)).toHaveLength(0);
  await database.update(schema.uploads).set({ expiresAt: new Date(0) });
  await expect(enqueueCompletedUpload(study.id, "owner")).rejects.toMatchObject({ status: 410 });
});
it("marks failed upload initialization without enqueueing work", async () => {
  state.create.mockRejectedValue(new Error("S3 unavailable"));
  await expect(createStudy("owner", input)).rejects.toThrow("S3 unavailable");
  expect(await database.select().from(schema.studies)).toMatchObject([{ status: "failed" }]);
  expect(await database.select().from(schema.jobs)).toHaveLength(0);
});
it("protects private frame routes, validates names, and streams only recorded frames", async () => {
  const study = await createStudy("owner", { ...input, visibility: "private" });
  await database.update(schema.studies).set({ status: "completed" });
  await database.insert(schema.frames).values({ studyId: study.id, name: "000001.webp", timestampMs: 0, objectKey: "internal/frame" });
  const request = new Request(`http://localhost/${study.id}/frames/000001.webp`);
  const params = Promise.resolve({ id: study.id, name: "000001.webp" });
  state.getSession.mockResolvedValue(null);
  expect((await frameGET(request, { params })).status).toBe(404);
  expect(state.get).not.toHaveBeenCalled();
  state.getSession.mockResolvedValue({ user: { id: "owner" } });
  state.get.mockResolvedValue({ Body: { transformToWebStream: () => Readable.toWeb(Readable.from(Buffer.from("webp"))) } });
  const response = await frameGET(request, { params });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("webp");
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await frameGET(request, { params: Promise.resolve({ id: study.id, name: "../source" }) })).status).toBe(404);
  expect((await frameGET(request, { params: Promise.resolve({ id: study.id, name: "000002.webp" }) })).status).toBe(404);
});
it("moves failed processing out of processing and distinguishes retry from final failure", async () => {
  const study = await createStudy("owner", input);
  state.head.mockResolvedValue({ ContentLength: input.video.size });
  await enqueueCompletedUpload(study.id, "owner");
  state.get.mockRejectedValue(new Error("Storage unavailable"));
  const job = { data: { studyId: study.id, sourceObjectKey: `studies/${study.id}/source`, options: input.processing },
    id: study.id, attemptsMade: 0, opts: { attempts: 3 } };
  await expect(processVideo(job)).rejects.toThrow("Storage unavailable");
  expect((await readableStudy(study.id))?.status).toBe("queued");
  await expect(processVideo({ ...job, attemptsMade: 2 })).rejects.toThrow("Storage unavailable");
  expect((await readableStudy(study.id))?.status).toBe("failed");
  expect(await database.select().from(schema.jobs)).toMatchObject([{ status: "failed", attempts: 3 }]);
});
it("rejects an oversized remote object before downloading", async () => {
  const study = await createStudy("owner", input);
  state.head.mockResolvedValue({ ContentLength: input.video.size });
  await enqueueCompletedUpload(study.id, "owner");
  state.get.mockResolvedValue({ Body: {}, ContentLength: input.video.size + 1 });
  await expect(processVideo({ data: { studyId: study.id, sourceObjectKey: `studies/${study.id}/source`, options: input.processing },
    id: study.id, attemptsMade: 0, opts: { attempts: 1 } })).rejects.toThrow("Source size mismatch");
  expect((await readableStudy(study.id))?.status).toBe("failed");
});
it("runs the worker on real video and commits frames, metadata and terminal state once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "valostudy-pipeline-"));
  try {
    const path = join(directory, "source.mp4");
    await runProcess("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
      "-t", "3", "-c:v", "mpeg4", path], 10000);
    const bytes = await readFile(path);
    const study = await createStudy("owner", { ...input, video: { ...input.video, size: bytes.length } });
    state.head.mockResolvedValue({ ContentLength: bytes.length });
    await enqueueCompletedUpload(study.id, "owner");
    state.get.mockImplementation(async () => ({
      ContentLength: bytes.length, Body: { transformToWebStream: () => Readable.toWeb(Readable.from(bytes)) },
    }));
    const job = { id: study.id, attemptsMade: 0, opts: { attempts: 3 },
      data: { studyId: study.id, sourceObjectKey: `studies/${study.id}/source`, options: input.processing } };
    await processVideo(job);
    const result = await buildManifest(study.id);
    expect(result.status).toBe("completed");
    expect(result.frames.map((f) => f.timestampMs)).toEqual([0, 1000, 2000]);
    expect(state.putFrame).toHaveBeenCalledTimes(3);
    expect((await database.select().from(schema.uploads))[0].metadata).toEqual({ width: 320, height: 240, duration: 3 });
    expect((await database.select().from(schema.jobs))[0].status).toBe("completed");
    expect(state.delete).toHaveBeenCalledWith(`studies/${study.id}/source`);
    await processVideo(job);
    expect(state.get).toHaveBeenCalledTimes(1);
    expect((await buildManifest(study.id)).prompt).toBe(result.prompt);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
