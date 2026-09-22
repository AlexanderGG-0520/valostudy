import { beforeEach, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { id, manifest } from "./fixtures";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  buildManifest: vi.fn(),
  readableStudy: vi.fn(),
  buildPublicAiStudyIndex: vi.fn(),
  buildPublicAiFramePage: vi.fn(),
}));
vi.mock("../apps/web/lib/auth", () => ({ auth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("../apps/web/lib/studies", () => ({
  buildManifest: mocks.buildManifest,
  readableStudy: mocks.readableStudy,
  buildPublicAiStudyIndex: mocks.buildPublicAiStudyIndex,
  buildPublicAiFramePage: mocks.buildPublicAiFramePage,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
import { GET } from "../apps/web/app/[id]/manifest.json/route";
import StudyPage from "../apps/web/app/[id]/page";
import AiStudyPage from "../apps/web/app/ai/[id]/page";
import AiFrameIndexPage from "../apps/web/app/ai/[id]/frames/[page]/page";
import robots from "../apps/web/app/robots";
import { HttpError } from "../apps/web/lib/http";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue(null);
  mocks.buildManifest.mockResolvedValue(manifest);
  mocks.readableStudy.mockResolvedValue({ visibility: "public" });
  mocks.buildPublicAiStudyIndex.mockResolvedValue({
    studyId: manifest.studyId,
    player: manifest.player,
    status: manifest.status,
    framesExpiredAt: manifest.framesExpiredAt,
    frameCount: manifest.frames.length,
    timestampNote: manifest.timestampNote,
    coachingProtocol: manifest.coachingProtocol,
    prompt: manifest.prompt,
  });
  mocks.buildPublicAiFramePage.mockResolvedValue({
    studyId: manifest.studyId,
    total: manifest.frames.length,
    timestampNote: manifest.timestampNote,
    frames: manifest.frames,
  });
});

it("serves /{id}/manifest.json with no storage keys and without caching private data", async () => {
  const response = await GET(new Request(`http://localhost/${id}/manifest.json`), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(manifest);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.buildManifest).toHaveBeenCalledWith(id, undefined);
});

it("returns 404 for an unauthorized manifest", async () => {
  mocks.buildManifest.mockRejectedValue(new HttpError(404, "Study not found"));
  expect((await GET(new Request(`http://localhost/${id}/manifest.json`), { params: Promise.resolve({ id }) })).status).toBe(404);
});

it("renders /{id} on the server with escaped user data and correct URLs", async () => {
  const html = renderToStaticMarkup(await StudyPage({ params: Promise.resolve({ id }) }));
  expect(html).toContain(`/${id}/manifest.json`);
  expect(html).toContain(`/ai/${id}`);
  expect(html).toContain("AIで試合をコーチング");
  expect(html).toContain("/mcp");
  expect(html).toContain(`/${id}/frames/000001.jpg`);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
});

it("renders unauthorized Studies as not found", async () => {
  mocks.buildManifest.mockRejectedValue(new HttpError(404, "Study not found"));
  await expect(StudyPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NEXT_NOT_FOUND");
});

it("renders a public AI entrypoint with player settings, prompt, and machine-readable links", async () => {
  const html = renderToStaticMarkup(await AiStudyPage({ params: Promise.resolve({ id }) }));
  expect(html).toContain("ValoStudy AI Entry Point");
  expect(html).toContain("Player settings");
  expect(html).toContain("Coaching prompt");
  expect(html).toContain("Read Reddit and inspect frames");
  expect(html).toContain(`/${id}/manifest.json`);
  expect(html).toContain(`/${id}/canonical.json`);
  expect(html).toContain(`/ai/${id}/frames/1`);
  expect(mocks.buildPublicAiStudyIndex).toHaveBeenCalledWith(id);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
});

it("does not expose unauthorized Studies through the AI entrypoint", async () => {
  mocks.buildPublicAiStudyIndex.mockRejectedValue(new HttpError(404, "Study not found"));
  await expect(AiStudyPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NEXT_NOT_FOUND");
});

it("paginates AI frame indexes and links directly to frame evidence", async () => {
  mocks.buildPublicAiFramePage.mockResolvedValue({
    studyId: id,
    total: 241,
    timestampNote: manifest.timestampNote,
    frames: [{
      timestampMs: 48_000,
      url: `/${id}/frames/000241.jpg`,
    }],
  });
  const html = renderToStaticMarkup(await AiFrameIndexPage({
    params: Promise.resolve({ id, page: "2" }),
  }));
  expect(html).toContain("page 2 of 2");
  expect(html).toContain("frames 241–241");
  expect(html).toContain(`/${id}/frames/000241.jpg`);
  expect(html).toContain(`/ai/${id}/frames/1`);
  expect(mocks.buildPublicAiFramePage).toHaveBeenCalledWith(id, 240, 240);
});

it("rejects invalid AI frame index pages", async () => {
  await expect(AiFrameIndexPage({
    params: Promise.resolve({ id, page: "0" }),
  })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mocks.buildPublicAiFramePage).not.toHaveBeenCalled();
});

it("explicitly permits ChatGPT search and user-triggered crawlers", () => {
  expect(robots()).toEqual({
    rules: [
      { userAgent: "OAI-SearchBot", allow: "/" },
      { userAgent: "ChatGPT-User", allow: "/" },
      { userAgent: "GPTBot", disallow: "/" },
      { userAgent: "*", allow: "/" },
    ],
  });
});
