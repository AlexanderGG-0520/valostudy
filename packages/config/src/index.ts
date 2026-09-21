import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PLUS_PRICE_ID: z.string().min(1).optional(),
  STRIPE_PRO_PRICE_ID: z.string().min(1).optional(),
  STRIPE_PLUS_PAYMENT_LINK_URL: z.url().default("https://buy.stripe.com/5kQbJ0gR2fp9alR1ow9IQ04"),
  STRIPE_PRO_PAYMENT_LINK_URL: z.url().default("https://buy.stripe.com/cNi6oG58k1yj3Xtd7e9IQ05"),
  WORKER_FFMPEG_THREADS: z.coerce.number().int().min(1).max(32).default(2),
  WORKER_FRAME_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(16),
}).superRefine((value, ctx) => {
  const hostname = new URL(value.S3_ENDPOINT).hostname.toLowerCase();
  if (!hostname.endsWith(".r2.cloudflarestorage.com")) return;

  if (value.S3_REGION !== "auto") {
    ctx.addIssue({
      code: "custom",
      path: ["S3_REGION"],
      message: "Cloudflare R2 requires S3_REGION=auto",
    });
  }
  if (value.S3_ACCESS_KEY.length !== 32) {
    ctx.addIssue({
      code: "custom",
      path: ["S3_ACCESS_KEY"],
      message: "Cloudflare R2 requires the 32-character S3 Access Key ID from Manage R2 API tokens, not the API token value",
    });
  }
  if (value.S3_SECRET_KEY.length !== 64) {
    ctx.addIssue({
      code: "custom",
      path: ["S3_SECRET_KEY"],
      message: "Cloudflare R2 requires the 64-character S3 Secret Access Key from Manage R2 API tokens",
    });
  }
});

export class ConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid server configuration: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
  }
}

export function config() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigurationError(parsed.error.issues.map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "environment";
      return `${path}: ${issue.message}`;
    }));
  }
  return parsed.data;
}

export const QUEUE_NAME = "video-processing";

export function redisConnection() {
  const url = new URL(config().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export function log(event: string, context: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...context }));
}
