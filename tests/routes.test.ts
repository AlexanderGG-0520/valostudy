import { beforeEach, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { id, manifest } from "./fixtures";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), buildManifest: vi.fn() }));
vi.mock("../apps/web/lib/auth", () => ({ auth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("../apps/web/lib/studies", () => ({ buildManifest: mocks.buildManifest }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
import { GET } from "../apps/web/app/[id]/manifest.json/route";
import StudyPage from "../apps/web/app/[id]/page";
import robots from "../apps/web/app/robots";
import { HttpError } from "../apps/web/lib/http";
beforeEach(() => { vi.resetAllMocks(); mocks.getSession.mockResolvedValue(null); mocks.buildManifest.mockResolvedValue(manifest); });
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
  expect(html).toContain(`/${id}/frames/000001.jpg`);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
});
it("renders unauthorized Studies as not found", async () => {
  mocks.buildManifest.mockRejectedValue(new HttpError(404, "Study not found"));
  await expect(StudyPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NEXT_NOT_FOUND");
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
