import { it, expect, vi } from "vitest";
vi.mock("../apps/web/lib/auth", () => ({ auth: () => ({ api: { getSession: async () => null } }) }));
import { jsonBody, handle, owner } from "../apps/web/lib/http";
import { StorageOperationError } from "@valostudy/storage";

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

it("logs storage operation and provider metadata without exposing it to the client", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const providerError = Object.assign(
      new Error("Credential access key has length 64, should be 32"),
      {
        name: "InvalidArgument",
        $fault: "client",
        $metadata: {
          httpStatusCode: 400,
          requestId: "r2-request-id",
          attempts: 1,
          totalRetryDelay: 0,
        },
      },
    );

    const result = await handle(async () => {
      throw new StorageOperationError("CreateMultipartUpload", providerError);
    }, { requestOperation: "study.create" });

    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain("Credential access key");

    const line = String(logSpy.mock.calls.at(-1)?.[0]);
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: "request_failed",
      requestOperation: "study.create",
      operation: "CreateMultipartUpload",
      reason: "StorageOperationError",
      causeReason: "InvalidArgument",
      causeMessage: "Credential access key has length 64, should be 32",
      httpStatusCode: 400,
      requestId: "r2-request-id",
      attempts: 1,
    });
  } finally {
    logSpy.mockRestore();
  }
});

it("rejects unauthenticated mutations", async () => {
  await expect(owner(new Request("http://localhost"))).rejects.toMatchObject({ status: 401 });
});
