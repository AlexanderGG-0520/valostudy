import { ZodError } from "zod";
import { config, log } from "@valostudy/config";
import { auth } from "./auth";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const SECRET_ENV_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

function redact(value: string) {
  let result = value
    .replace(/X-Amz-(Credential|Signature|Security-Token)=[^&\s]+/gi, "X-Amz-$1=[redacted]");
  for (const key of SECRET_ENV_KEYS) {
    const secret = process.env[key];
    if (secret && secret.length >= 8) result = result.replaceAll(secret, "[redacted]");
  }
  return result;
}

function metadataOf(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const metadata = (value as { $metadata?: unknown }).$metadata;
  return metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : undefined;
}

function errorDetails(error: unknown) {
  const details: Record<string, unknown> = {
    reason: error instanceof Error ? error.name : "Unknown",
  };

  if (error instanceof Error) {
    details.message = redact(error.message);
    if (error.stack) details.stack = redact(error.stack).slice(0, 6000);
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.operation === "string") details.operation = record.operation;
    if (typeof record.$fault === "string") details.fault = record.$fault;
    if (typeof record.Code === "string") details.providerCode = record.Code;
  }

  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) {
    details.causeReason = cause.name;
    details.causeMessage = redact(cause.message);
    const causeRecord = cause as unknown as Record<string, unknown>;
    if (typeof causeRecord.Code === "string") details.providerCode = causeRecord.Code;
    if (typeof causeRecord.$fault === "string") details.fault = causeRecord.$fault;
  }

  const metadata = metadataOf(cause) ?? metadataOf(error);
  if (metadata) {
    for (const key of ["httpStatusCode", "requestId", "extendedRequestId", "cfId", "attempts", "totalRetryDelay"]) {
      if (metadata[key] !== undefined) details[key] = metadata[key];
    }
  }

  return details;
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

export function handle(action: () => Promise<Response>, context: Record<string, unknown> = {}) {
  return action().catch((error: unknown) => {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: "Validation failed", issues: error.issues }, { status: 400 });
    log("request_failed", { ...context, ...errorDetails(error) });
    return Response.json({ error: "Operation failed; retry or contact the operator" }, { status: 500 });
  });
}
