import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { Queue } from "bullmq";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { manifestSchema, vcmrMatchSchema, PART_BYTES, type Manifest } from "@valostudy/schema";
import { config, redisConnection, QUEUE_NAME } from "@valostudy/config";
import { input } from "../fixtures";

const c = config();
const video = process.env.E2E_VIDEO!;
const sql = postgres(c.DATABASE_URL, { max: 2 });
const queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
const s3 = new S3Client({ endpoint: c.S3_ENDPOINT, region: c.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY } });
test.afterAll(async () => { await queue.close(); await sql.end(); s3.destroy(); });

async function signup(page: Page) {
  await page.goto("/");
  await page.getByLabel("操作", { exact: true }).selectOption("signup");
  await page.getByLabel("メール", { exact: true }).fill(randomBytes(8).toString("hex") + "@example.test");
  await page.getByLabel("パスワード", { exact: false }).fill(randomBytes(20).toString("hex"));
  await page.getByLabel("利用規約", { exact: false }).check();
  await page.getByLabel("プライバシーポリシー", { exact: false }).check();
  await page.getByRole("button", { name: "続ける", exact: true }).click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
}
async function terminal(request: APIRequestContext, id: string, status: "completed" | "failed") {
  let result: Manifest | undefined;
  await expect.poll(async () => {
    const response = await request.get("/" + id + "/manifest.json");
    expect([200, 202]).toContain(response.status());
    result = manifestSchema.parse(await response.json());
    if (response.status() === 202) {
      expect(response.headers()["retry-after"]).toBe("5");
      expect(["pending", "queued", "processing"]).toContain(result.status);
    } else if (result.status === status) {
      expect(response.status()).toBe(200);
    }
    return result.status;
  }, { timeout: 90000, intervals: [500, 1000, 2000] }).toBe(status);
  return result!;
}
async function persisted(id: string, status: "completed" | "failed") {
  const rows = await sql`select s.status as study_status, j.status as job_status, j.attempts
    from studies s join processing_jobs j on j.study_id = s.id where s.id = ${id}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ study_status: status, job_status: status });
  await expect.poll(async () => (await queue.getJob(id))?.getState(), { timeout: 15000 }).toBe(status);
  return rows[0];
}
async function submit(page: Page, visibility: "public" | "private", invalid = false) {
  await page.getByLabel("画質・Reflexなど").fill("Low / Reflex ON");
  await page.getByLabel("フレーム抽出間隔").selectOption("1");
  await page.getByLabel("公開範囲").selectOption(visibility);
  if (invalid) await page.getByLabel("試合全体の録画（最大16 GiB）").setInputFiles({
    name: "invalid.mp4", mimeType: "video/mp4", buffer: Buffer.from("This is not a video"),
  });
  else await page.getByLabel("試合全体の録画（最大16 GiB）").setInputFiles(video);
  const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/studies" && r.request().method() === "POST");
  await page.getByRole("button", { name: "試合全体をStudyにする" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const result = await response.json() as { studyId: string; partCount: number };
  expect(result.studyId).toMatch(/^[0-9a-f]{11}$/);
  await expect(page.getByRole("status")).toContainText("アップロード完了", { timeout: 45000 });
  return result;
}

for (const visibility of ["public", "private"] as const) {
  test(`browser direct multipart → real Worker → ${visibility} manifest and JPEG`, async ({ page, browser }) => {
    const putOrigins: string[] = [];
    const webBodies: number[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "PUT") putOrigins.push(url.origin);
      if (url.origin === c.BETTER_AUTH_URL && request.method() === "POST")
        webBodies.push(request.postDataBuffer()?.length ?? 0);
    });
    await signup(page);
    const { studyId: id, partCount } = await submit(page, visibility);
    expect(partCount).toBe(2); // Real AVI fixture >16 MiB, not a single-part shortcut.
    expect(putOrigins).toHaveLength(2);
    expect(putOrigins.every((origin) => origin === c.S3_ENDPOINT)).toBe(true);
    expect(partCount * PART_BYTES).toBeGreaterThan((await stat(video)).size);
    expect(webBodies.every((size) => size < 32768)).toBe(true);
    const manifest = await terminal(page.request, id, "completed");
    expect(manifest.frames.map((f) => f.timestampMs)).toEqual([0, 1000, 2000]);
    expect(manifest.player.rank).toBe("Platinum 3");
    expect(manifest.prompt).toContain("Reddit");
    expect(manifest.coachingProtocol).toEqual({ redditResearchRequired: true, promptTemplateVersion: "v1" });
    expect(JSON.stringify(manifest)).not.toContain(c.S3_ENDPOINT);
    expect(JSON.stringify(manifest)).not.toContain("studies/");

    const canonicalResponse = await page.request.get(`/${id}/canonical.json`);
    expect(canonicalResponse.status()).toBe(200);
    expect(canonicalResponse.headers()["content-type"]).toContain("application/vnd.valostudy.vcmr+json");
    const canonical = vcmrMatchSchema.parse(await canonicalResponse.json());
    expect(canonical.schema).toBe("valostudy.vcmr");
    expect(canonical.schemaVersion).toBe("1.0.0");
    expect(canonical.study).toMatchObject({ id, game: "valorant", visibility, status: "completed" });
    expect(canonical.media.sampling.fps).toBe(1);
    expect(canonical.frames.map((frame) => frame.id)).toEqual([
      "frame_000001",
      "frame_000002",
      "frame_000003",
    ]);
    expect(canonical.rounds).toEqual([]);
    expect(canonical.events).toEqual([]);
    expect(canonical.annotations).toEqual([]);

    const row = await persisted(id, "completed");
    expect(row.attempts).toBe(1);
    await expect.poll(async () => {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: c.S3_BUCKET, Key: `studies/${id}/source` }));
        return true;
      } catch {
        return false;
      }
    }, { timeout: 15000 }).toBe(false);
    const job = await queue.getJob(id);
    expect(job?.data).toMatchObject({ studyId: id, sourceObjectKey: `studies/${id}/source`, options: { fps: 1 } });
    for (const frame of manifest.frames) {
      expect(frame.url).toMatch(new RegExp(`^/${id}/frames/[0-9]{6}\\.jpg$`));
      const response = await page.request.get(frame.url);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/jpeg");
      expect(Array.from((await response.body()).subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    }
    await page.goto("/" + id);
    await expect(page.getByRole("heading", { name: "Study " + id })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AIで試合をコーチング" })).toBeVisible();
    const promptCopyButton = page.getByRole("button", { name: "コーチングプロンプトをコピー" });
    if (visibility === "public") await expect(promptCopyButton).toBeEnabled();
    else {
      await expect(promptCopyButton).toBeDisabled();
      await expect(page.getByText("現在のValoStudy MCPは公開Studyのみ参照できます。", { exact: false })).toBeVisible();
    }
    await expect(page.locator("img")).toHaveCount(3);
    const anonymous = await browser.newContext({ baseURL: c.BETTER_AUTH_URL });
    try {
      for (const path of [
        "/" + id,
        "/" + id + "/manifest.json",
        "/" + id + "/canonical.json",
        manifest.frames[0].url,
      ])
        expect((await anonymous.request.get(path)).status()).toBe(visibility === "public" ? 200 : 404);

      if (visibility === "public") {
        const mcpCall = async (name: string, args: Record<string, unknown>) => {
          const response = await anonymous.request.post("/mcp", {
            headers: {
              "content-type": "application/json",
              "accept": "application/json, text/event-stream",
              "mcp-protocol-version": "2026-07-28",
              "mcp-method": "tools/call",
              "mcp-name": name,
            },
            data: {
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name,
                arguments: args,
                _meta: {
                  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                  "io.modelcontextprotocol/clientInfo": { name: "valostudy-e2e", version: "1.0.0" },
                  "io.modelcontextprotocol/clientCapabilities": {},
                },
              },
            },
          });
          expect(response.status()).toBe(200);
          return response.json() as Promise<{
            result: {
              resultType?: string;
              content?: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
              structuredContent?: Record<string, unknown>;
            };
          }>;
        };

        const listed = await mcpCall("list_frames", { study_id: id, offset: 0, limit: 1 });
        expect(listed.result.resultType).toBe("complete");
        const listedFrame = (listed.result.structuredContent?.frames as Array<{ url: string }>)[0];
        expect(new URL(listedFrame.url).origin).toBe(new URL(c.PUBLIC_APP_URL ?? c.BETTER_AUTH_URL).origin);
        expect(listedFrame.url).not.toContain("0.0.0.0");

        const frameName = manifest.frames[0].url.split("/").at(-1)!;
        const frameResult = await mcpCall("get_frame", { study_id: id, frame_name: frameName });
        expect(frameResult.result.resultType).toBe("complete");
        expect(frameResult.result.structuredContent).toBeUndefined();
        expect(frameResult.result.content?.[0]).toMatchObject({
          type: "image",
          mimeType: "image/jpeg",
        });
        const imageBytes = Buffer.from(frameResult.result.content?.[0].data ?? "", "base64");
        expect(Array.from(imageBytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
        const metadata = JSON.parse(frameResult.result.content?.[1].text ?? "{}") as { url: string; mime_type: string };
        expect(metadata.mime_type).toBe("image/jpeg");
        expect(new URL(metadata.url).origin).toBe(new URL(c.PUBLIC_APP_URL ?? c.BETTER_AUTH_URL).origin);
        expect(metadata.url).not.toContain("0.0.0.0");
      }
      // Even another authenticated account cannot mutate the owner's upload.
      const other = await anonymous.newPage();
      await signup(other);
      expect((await anonymous.request.post(`/api/uploads/${id}/parts`, { data: { partNumber: 1 } })).status()).toBe(404);
      expect((await anonymous.request.post(`/api/uploads/${id}/complete`)).status()).toBe(404);
      if (visibility === "private")
        expect((await anonymous.request.get("/" + id + "/manifest.json")).status()).toBe(404);
    } finally { await anonymous.close(); }
  });
}

test("invalid media reaches failed in PostgreSQL and BullMQ after bounded retries", async ({ page }) => {
  await signup(page);
  const { studyId: id } = await submit(page, "private", true);
  const manifest = await terminal(page.request, id, "failed");
  expect(manifest.frames).toEqual([]);
  expect((await persisted(id, "failed")).attempts).toBe(3);
  expect((await page.request.get(`/${id}/frames/000001.jpg`)).status()).toBe(404);
});

test("real multipart validation and concurrent completion produce exactly one job", async ({ page }) => {
  await signup(page);
  const bytes = await readFile(video);
  const response = await page.request.post("/api/studies", {
    data: { ...input, video: { size: bytes.length, mimeType: "video/x-msvideo" } },
  });
  expect(response.status()).toBe(201);
  const { studyId: id, partCount } = await response.json() as { studyId: string; partCount: number };
  expect((await page.request.post(`/api/uploads/${id}/complete`)).status()).toBe(400);
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const signed = await page.request.post(`/api/uploads/${id}/parts`, { data: { partNumber } });
    expect(signed.status()).toBe(200);
    const { url } = await signed.json() as { url: string };
    if (partNumber === 1) {
      const wrongSize = await fetch(url, { method: "PUT", body: Buffer.from("wrong-size") });
      expect(wrongSize.status).toBe(403);
    }
    expect((await fetch(url, { method: "PUT", body: bytes.subarray((partNumber - 1) * PART_BYTES, partNumber * PART_BYTES) })).status).toBe(200);
  }
  const completions = await Promise.all(Array.from({ length: 4 }, () => page.request.post(`/api/uploads/${id}/complete`)));
  expect(completions.map((r) => r.status())).toEqual([202, 202, 202, 202]);
  await terminal(page.request, id, "completed");
  expect((await persisted(id, "completed")).attempts).toBe(1);
  const rows = await sql`select count(*)::integer as count from processing_jobs where study_id = ${id}`;
  expect(rows[0].count).toBe(1);
});
