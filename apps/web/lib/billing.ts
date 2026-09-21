import { createHash } from "node:crypto";
import { db, billingSubscriptions, usageEvents, user, eq, and, isNull, gte, desc } from "@valostudy/db";
import { PLAN_LIMITS, type Plan, type StudyCreation } from "@valostudy/schema";
import { HttpError } from "./http";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Keep privileged developer identities out of the repository as plaintext.
// This is SHA-256(lowercase(trim(email))) for the designated developer account.
const DEVELOPER_PRO_EMAIL_HASHES = new Set([
  "ead51cab682dca2e4e1a755eca29b222e26cf333b5f9d2171e0f3d0097a48064",
]);

function emailHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function paidPlanActive(status: string, currentPeriodEnd: Date | null, now: Date) {
  if (status === "active" || status === "trialing") return true;
  if (status === "past_due") {
    const base = currentPeriodEnd?.getTime() ?? now.getTime();
    return now.getTime() <= base + 3 * DAY;
  }
  if (status === "canceled" && currentPeriodEnd)
    return currentPeriodEnd.getTime() > now.getTime();
  return false;
}

async function resolveEntitlement(userId: string, now: Date) {
  const [account] = await db().select({ email: user.email }).from(user).where(eq(user.id, userId));

  // Developer entitlement is authoritative and must not depend on Stripe state.
  // Evaluate it before reading billing_subscriptions so the override still resolves
  // while billing infrastructure is being migrated or recovered.
  if (account && DEVELOPER_PRO_EMAIL_HASHES.has(emailHash(account.email))) {
    return {
      plan: "pro" as const,
      entitlementSource: "developer" as const,
      subscription: null,
    };
  }

  const [subscription] = await db().select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.userId, userId));

  if (subscription && subscription.plan !== "free"
    && paidPlanActive(subscription.status, subscription.currentPeriodEnd, now)) {
    return {
      plan: subscription.plan,
      entitlementSource: "stripe" as const,
      subscription,
    };
  }

  return {
    plan: "free" as const,
    entitlementSource: "free" as const,
    subscription,
  };
}

export async function currentPlan(userId: string, now = new Date()): Promise<Plan> {
  return (await resolveEntitlement(userId, now)).plan;
}

export function assertPlanInput(plan: Plan, input: StudyCreation) {
  const limits = PLAN_LIMITS[plan];
  if (input.video.size > limits.maxUploadBytes)
    throw new HttpError(403, `${limits.label} allows uploads up to ${limits.maxUploadBytes / 1024 ** 3} GiB`);
  if (input.processing.fps > limits.maxFps)
    throw new HttpError(403, `${limits.label} allows sampling up to ${limits.maxFps} FPS`);
}

export async function billingStatus(userId: string, now = new Date()) {
  const entitlement = await resolveEntitlement(userId, now);
  const { plan, subscription, entitlementSource } = entitlement;
  const limits = PLAN_LIMITS[plan];

  let used = 0;
  let canCreate = true;
  let nextAvailableAt: string | null = null;

  if (plan === "free") {
    const [last] = await db().select().from(usageEvents).where(and(
      eq(usageEvents.ownerId, userId),
      eq(usageEvents.plan, plan),
      isNull(usageEvents.releasedAt),
    )).orderBy(desc(usageEvents.consumedAt)).limit(1);
    if (last) {
      const availableAt = new Date(last.consumedAt.getTime() + limits.cooldownHours! * HOUR);
      if (availableAt > now) {
        canCreate = false;
        nextAvailableAt = availableAt.toISOString();
      }
    }
  } else {
    const windowStart = new Date(now.getTime() - limits.rollingWindowDays! * DAY);
    const recent = await db().select().from(usageEvents).where(and(
      eq(usageEvents.ownerId, userId),
      eq(usageEvents.plan, plan),
      isNull(usageEvents.releasedAt),
      gte(usageEvents.consumedAt, windowStart),
    )).orderBy(usageEvents.consumedAt);
    used = recent.length;
    if (limits.rollingStudyLimit !== null && used >= limits.rollingStudyLimit) {
      canCreate = false;
      const oldest = recent[0];
      if (oldest)
        nextAvailableAt = new Date(oldest.consumedAt.getTime() + limits.rollingWindowDays! * DAY).toISOString();
    }
  }

  return {
    plan,
    entitlementSource,
    limits,
    usage: {
      used,
      canCreate,
      nextAvailableAt,
      publicLimitLabel: limits.publicStudyLimitLabel,
      displayLimit: plan === "pro" ? null : limits.rollingStudyLimit,
    },
    subscription: subscription ? {
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      hasCustomer: Boolean(subscription.stripeCustomerId),
    } : null,
  };
}
