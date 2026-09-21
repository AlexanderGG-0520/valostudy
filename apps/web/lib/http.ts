import { ZodError } from "zod";
import { config, log } from "@valostudy/config";
import { auth } from "./auth";
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function owner(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(config().BETTER_AUTH_URL).origin) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new HttpError(403, "Origin rejected");
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "Sign in required");
  return session.user.id;
}
export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "JSON required; upload video directly to storage");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new HttpError(413, "JSON body too large"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (e) {
    if (e instanceof SyntaxError) throw new HttpError(400, "Invalid JSON");
    throw e;
  } finally { reader.releaseLock(); }
}
export function handle(action: () => Promise<Response>) {
  return action().catch((error: unknown) => {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: "Validation failed", issues: error.issues }, { status: 400 });
    log("request_failed", { reason: error instanceof Error ? error.name : "Unknown" });
    return Response.json({ error: "Operation failed; retry or contact the operator" }, { status: 500 });
  });
}
