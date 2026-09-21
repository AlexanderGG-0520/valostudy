import { it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
vi.mock("@valostudy/config", () => ({ config: () => ({
  S3_ENDPOINT: "https://storage.example.test", S3_REGION: "auto", S3_BUCKET: "private-bucket",
  S3_ACCESS_KEY: randomBytes(10).toString("hex"), S3_SECRET_KEY: randomBytes(20).toString("hex"),
}) }));
import { Storage, sourceKey } from "@valostudy/storage";
it("signs the exact part size without requiring an empty-body checksum", async () => {
  const url = new URL(await new Storage().partUrl(sourceKey("3fa91bc72de"), "upload-session", 1, 1024, 300));
  expect(url.hostname).toBe("storage.example.test");
  expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-length");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(url.searchParams.get("partNumber")).toBe("1");
  expect(url.searchParams.get("uploadId")).toBe("upload-session");
  expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
});
