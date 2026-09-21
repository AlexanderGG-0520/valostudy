import { createHash, randomBytes } from "node:crypto";
import { apiKeys, db, eq, and, isNull } from "@valostudy/db";
import { PLAN_LIMITS } from "@valostudy/schema";
import { billingStatus } from "./billing";
import { HttpError } from "./http";

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createApiKey(userId: string, name: string) {
  const entitlement = await billingStatus(userId);
  if (!PLAN_LIMITS[entitlement.plan].apiAccess)
    throw new HttpError(403, "API access requires Pro");

  const existing = await db().select({ id: apiKeys.id }).from(apiKeys).where(and(
    eq(apiKeys.userId, userId),
    isNull(apiKeys.revokedAt),
  ));
  if (existing.length >= 5) throw new HttpError(409, "Revoke an API key before creating another");

  const secret = `vsk_${randomBytes(32).toString("base64url")}`;
  const id = randomBytes(8).toString("hex");
  await db().insert(apiKeys).values({
    id,
    userId,
    name: name.trim().slice(0, 60) || "API key",
    prefix: secret.slice(0, 12),
    keyHash: hashKey(secret),
  });
  return { id, secret };
}

export async function listApiKeys(userId: string) {
  const rows = await db().select({
    id: apiKeys.id,
    name: apiKeys.name,
    prefix: apiKeys.prefix,
    createdAt: apiKeys.createdAt,
    lastUsedAt: apiKeys.lastUsedAt,
    revokedAt: apiKeys.revokedAt,
  }).from(apiKeys).where(eq(apiKeys.userId, userId));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeApiKey(userId: string, id: string) {
  const [row] = await db().select().from(apiKeys).where(and(
    eq(apiKeys.id, id),
    eq(apiKeys.userId, userId),
  ));
  if (!row) throw new HttpError(404, "API key not found");
  await db().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
}

export async function apiOwner(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Bearer API key required");
  const secret = authorization.slice(7).trim();
  if (!secret.startsWith("vsk_") || secret.length < 30) throw new HttpError(401, "Invalid API key");

  const [key] = await db().select().from(apiKeys).where(and(
    eq(apiKeys.keyHash, hashKey(secret)),
    isNull(apiKeys.revokedAt),
  ));
  if (!key) throw new HttpError(401, "Invalid API key");

  const entitlement = await billingStatus(key.userId);
  if (!PLAN_LIMITS[entitlement.plan].apiAccess)
    throw new HttpError(403, "API access requires an active Pro subscription");

  await db().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return key.userId;
}
