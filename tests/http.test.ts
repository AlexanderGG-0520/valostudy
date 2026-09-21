import { it, expect, vi } from "vitest";
vi.mock("../apps/web/lib/auth", () => ({ auth: () => ({ api: { getSession: async () => null } }) }));
import { jsonBody, handle, owner } from "../apps/web/lib/http";
it("rejects video bodies, malformed JSON, and oversized JSON even without Content-Length", async () => {
  await expect(jsonBody(new Request("http://localhost", { method: "POST", body: "video", headers: { "content-type": "video/mp4" } }))).rejects.toMatchObject({ status: 415 });
  await expect(jsonBody(new Request("http://localhost", { method: "POST", body: "{", headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ status: 400 });
  await expect(jsonBody(new Request("http://localhost", { method: "POST", body: JSON.stringify("x".repeat(40000)), headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ status: 413 });
});
it("does not expose internal exception details", async () => {
  const result = await handle(async () => { throw new Error("secret database password"); });
  expect(result.status).toBe(500);
  expect(await result.text()).not.toContain("password");
});
it("rejects unauthenticated mutations", async () => {
  await expect(owner(new Request("http://localhost"))).rejects.toMatchObject({ status: 401 });
});
