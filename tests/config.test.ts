import { afterEach, expect, it, vi } from "vitest";
import { config, ConfigurationError } from "@valostudy/config";

function stubConfig(overrides: Record<string, string> = {}) {
  const values = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/valostudy",
    REDIS_URL: "redis://localhost:6379",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(32),
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "us-east-1",
    S3_BUCKET: "valostudy",
    S3_ACCESS_KEY: "minio-access",
    S3_SECRET_KEY: "minio-secret",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it("keeps non-R2 S3-compatible credentials provider-agnostic", () => {
  stubConfig();
  expect(config().S3_ACCESS_KEY).toBe("minio-access");
});

it("rejects Cloudflare API-token-shaped credentials before the first R2 request", () => {
  stubConfig({
    S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    S3_REGION: "auto",
    S3_ACCESS_KEY: "a".repeat(64),
    S3_SECRET_KEY: "b".repeat(64),
  });

  expect(() => config()).toThrow(ConfigurationError);
  try {
    config();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).issues.join("\n")).toContain("S3_ACCESS_KEY");
    expect((error as Error).message).not.toContain("a".repeat(64));
  }
});

it("accepts the R2 S3 credential shape and requires region auto", () => {
  stubConfig({
    S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    S3_REGION: "auto",
    S3_ACCESS_KEY: "a".repeat(32),
    S3_SECRET_KEY: "b".repeat(64),
  });
  expect(config().S3_REGION).toBe("auto");

  vi.stubEnv("S3_REGION", "us-east-1");
  expect(() => config()).toThrow(/S3_REGION/);
});
