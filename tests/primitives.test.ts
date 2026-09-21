import { describe, it, expect } from "vitest";
import { generateStudyId, insertWithStudyId } from "@valostudy/db/id";
import { studyIdSchema, manifestSchema, playerSettingsSchema, studyCreationSchema, processingJobSchema, PART_BYTES, MAX_UPLOAD_BYTES, MAX_UPLOAD_PARTS, PLAN_LIMITS } from "@valostudy/schema";
import { sourceKey, frameKey, partSize } from "@valostudy/storage";
import { template, renderSnapshot } from "@valostudy/prompts";
import { id, input, manifest } from "./fixtures";
describe("Study IDs", () => {
  it("uses exactly 11 lowercase hexadecimal characters", () => {
    for (let i = 0; i < 1000; i++) expect(generateStudyId()).toMatch(/^[0-9a-f]{11}$/);
  });
  it.each(["", "ABC91bc72de", "3fa91bc72deg", "3fa91bc72d", "1234567890abcdef", "../anything", "550e8400-e29b-41d4-a716-446655440000"])("rejects invalid ID %s", (value) => {
    expect(studyIdSchema.safeParse(value).success).toBe(false);
  });
  it("regenerates collisions and limits retries", async () => {
    let tries = 0;
    expect(await insertWithStudyId(async (candidate) => ++tries < 3 ? undefined : candidate)).toMatch(/^[0-9a-f]{11}$/);
    expect(tries).toBe(3);
    tries = 0;
    await expect(insertWithStudyId(async () => { tries++; return undefined; })).rejects.toThrow("retry limit");
    expect(tries).toBe(8);
  });
  it("does not retry unrelated DB errors", async () => {
    let tries = 0;
    await expect(insertWithStudyId(async () => { tries++; throw new Error("connection lost"); })).rejects.toThrow("connection lost");
    expect(tries).toBe(1);
  });
});
describe("shared validation", () => {
  it("accepts the manifest and rejects internal or cross-Study frame URLs", () => {
    expect(manifestSchema.parse(manifest)).toEqual(manifest);
    for (const url of ["https://bucket.example/internal.webp", "/00000000000/frames/000001.webp", `/${id}/frames/../source`])
      expect(manifestSchema.safeParse({ ...manifest, frames: [{ timestampMs: 0, url }] }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...manifest, prompt: undefined }).success).toBe(false);
  });
  it("requires valid player settings and bounded uploads/extraction", () => {
    expect(playerSettingsSchema.parse(input.player)).toEqual(input.player);
    for (const dpi of [0, -1, Infinity, 1.5, 64001])
      expect(playerSettingsSchema.safeParse({ ...input.player, sensitivity: { dpi, inGame: 0.1 } }).success).toBe(false);
    expect(playerSettingsSchema.safeParse({ ...input.player, videoSettings: { resolution: "1920x1080" } }).success).toBe(false);
    expect(studyCreationSchema.safeParse({ ...input, video: { size: MAX_UPLOAD_BYTES + 1, mimeType: "video/mp4" } }).success).toBe(false);
    expect(studyCreationSchema.safeParse({ ...input, processing: { fps: 5 } }).success).toBe(true);
    expect(studyCreationSchema.safeParse({ ...input, processing: { fps: 3 } }).success).toBe(false);
    expect(PLAN_LIMITS.free.cooldownHours).toBe(6);
    expect(PLAN_LIMITS.plus.rollingStudyLimit).toBe(30);
    expect(PLAN_LIMITS.pro.publicStudyLimitLabel).toContain("Unlimited");
    expect(processingJobSchema.safeParse({ studyId: id, sourceObjectKey: sourceKey("00000000000"), options: input.processing }).success).toBe(false);
  });
});
describe("prompts", () => {
  it("renders player evidence and Reddit research protocol", () => {
    const snapshot = renderSnapshot(input);
    expect(snapshot.prompt).toContain("1600");
    expect(snapshot.prompt).toContain("Platinum 3");
    for (const term of ["Reddit", "patch", "meta", "ground truth", "frame evidence"]) expect(snapshot.prompt).toContain(term);
    expect(snapshot.templateVersion).toBe("v1");
  });
  it("keeps an earlier snapshot immutable when a new template is rendered", () => {
    const first = renderSnapshot(input);
    const serialized = JSON.stringify(first);
    const second = renderSnapshot(input, { ...template, version: "v2", coachingPrompt: "Changed future instructions" });
    expect(second.templateVersion).toBe("v2");
    expect(second.prompt).not.toBe(first.prompt);
    expect(JSON.stringify(first)).toBe(serialized);
  });
});
describe("object storage namespace and parts", () => {
  it("generates controlled keys and rejects traversal", () => {
    expect(sourceKey(id)).toBe(`studies/${id}/source`);
    expect(frameKey(id, "000001.jpg")).toBe(`studies/${id}/frames/000001.jpg`);
    expect(frameKey(id, "000001.webp")).toBe(`studies/${id}/frames/000001.webp`);
    expect(() => frameKey(id, "../../secret")).toThrow();
    expect(() => sourceKey("../source")).toThrow();
  });
  it("bounds every part, including the final partial part", () => {
    expect(partSize(PART_BYTES + 123, 1)).toBe(PART_BYTES);
    expect(partSize(PART_BYTES + 123, 2)).toBe(123);
    expect(MAX_UPLOAD_PARTS).toBe(Math.ceil(MAX_UPLOAD_BYTES / PART_BYTES));
    for (const part of [0, -1, 3, 1.5]) expect(() => partSize(PART_BYTES + 123, part)).toThrow();
  });
});
