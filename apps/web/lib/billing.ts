import { db, billingSubscriptions, usageEvents, eq, and, isNull, gte, desc } from "@valostudy/db";
import { PLAN_LIMITS, type Plan, type StudyCreation } from "@valostudy/schema";
import { HttpError } from "./http";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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

export async function currentPlan(userId: string, now = new Date()): Promise<Plan> {
  const [subscription] = await db().select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.userId, userId));
  if (!subscription || subscription.plan === "free") return "free";
  return paidPlanActive(subscription.status, subscription.currentPeriodEnd, now)
    ? subscription.plan
    : "free";
}

export function assertPlanInput(plan: Plan, input: StudyCreation) {
  const limits = PLAN_LIMITS[plan];
  if (input.video.size > limits.maxUploadBytes)
    throw new HttpError(403, `${limits.label} allows uploads up to ${limits.maxUploadBytes / 1024 ** 3} GiB`);
  if (input.processing.fps > limits.maxFps)
    throw new HttpError(403, `${limits.label} allows sampling up to ${limits.maxFps} FPS`);
}

export async function billingStatus(userId: string, now = new Date()) {
  const plan = await currentPlan(userId, now);
  const limits = PLAN_LIMITS[plan];
  const [subscription] = await db().select().from(billingSubscriptions)
    .where(eq(billingSubscriptions.userId, userId));

  let used = 0;
  let canCreate = true;
  let nextAvailableAt: string | null = null;

  if (plan === "free") {
    const [last] = await db().select().from(usageEvents).where(and(
      eq(usageEvents.ownerId, userId),
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
