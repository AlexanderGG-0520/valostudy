import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "@valostudy/config";
import {
  billingCheckoutIntents,
  billingSubscriptions,
  db,
  eq,
  stripeEvents,
} from "@valostudy/db";
import { planSchema, type Plan } from "@valostudy/schema";

const CHECKOUT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function stripeConfig() {
  const c = config();
  if (!c.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  return c;
}

async function stripeRequest(path: string, params: URLSearchParams) {
  const c = stripeConfig();
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok)
    throw new Error(typeof body.error === "object" && body.error && "message" in body.error
      ? String((body.error as { message?: unknown }).message ?? "Stripe request failed")
      : "Stripe request failed");
  return body;
}

async function stripeGet(path: string) {
  const c = stripeConfig();
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${c.STRIPE_SECRET_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok)
    throw new Error(typeof body.error === "object" && body.error && "message" in body.error
      ? String((body.error as { message?: unknown }).message ?? "Stripe request failed")
      : "Stripe request failed");
  return body;
}

function paymentLinkUrl(plan: Exclude<Plan, "free">) {
  const c = config();
  return plan === "plus"
    ? c.STRIPE_PLUS_PAYMENT_LINK_URL
    : c.STRIPE_PRO_PAYMENT_LINK_URL;
}

function canonicalPaymentLink(url: string) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
}

export async function createPaymentLinkCheckout(input: {
  userId: string;
  email: string;
  plan: Exclude<Plan, "free">;
}) {
  const intentId = randomBytes(24).toString("base64url");
  const now = new Date();
  await db().insert(billingCheckoutIntents).values({
    id: intentId,
    userId: input.userId,
    plan: input.plan,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CHECKOUT_INTENT_TTL_MS),
  });

  const url = new URL(paymentLinkUrl(input.plan));
  url.searchParams.set("client_reference_id", intentId);
  url.searchParams.set("prefilled_email", input.email);
  return url.toString();
}

export async function createPortalSession(customerId: string) {
  const c = stripeConfig();
  const origin = new URL(c.BETTER_AUTH_URL).origin;
  const result = await stripeRequest("/billing_portal/sessions", new URLSearchParams({
    customer: customerId,
    return_url: origin,
  }));
  if (typeof result.url !== "string") throw new Error("Stripe did not return a portal URL");
  return result.url;
}

export function verifyStripeSignature(raw: string, signatureHeader: string | null) {
  const secret = config().STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !signatures.length) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return signatures.some((signature) => {
    try {
      const actual = Buffer.from(signature, "hex");
      return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
    } catch {
      return false;
    }
  });
}

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const subscriptionSchema = z.object({
  id: z.string(),
  customer: z.union([z.string(), z.object({ id: z.string() })]),
  status: z.string(),
  current_period_end: z.number().optional(),
  cancel_at_period_end: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional().default({}),
  items: z.object({
    data: z.array(z.object({ price: z.object({ id: z.string() }) })),
  }).optional(),
});

const checkoutSchema = z.object({
  id: z.string().optional(),
  customer: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  subscription: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  payment_link: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  client_reference_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional().default({}),
});

const paymentLinkSchema = z.object({
  id: z.string(),
  url: z.url(),
  active: z.boolean(),
});

function objectId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function planFromSubscription(subscription: z.infer<typeof subscriptionSchema>): Exclude<Plan, "free"> | null {
  const price = subscription.items?.data[0]?.price.id;
  const c = config();
  if (price && price === c.STRIPE_PLUS_PRICE_ID) return "plus";
  if (price && price === c.STRIPE_PRO_PRICE_ID) return "pro";
  const metadataPlan = planSchema.safeParse(subscription.metadata.plan);
  if (metadataPlan.success && metadataPlan.data !== "free") return metadataPlan.data;
  return null;
}

async function resolvePaymentLinkCheckout(session: z.infer<typeof checkoutSchema>) {
  const intentId = session.client_reference_id;
  const paymentLinkId = objectId(session.payment_link);
  if (!intentId || !paymentLinkId) return null;

  const [intent] = await db().select().from(billingCheckoutIntents)
    .where(eq(billingCheckoutIntents.id, intentId));
  if (!intent || intent.consumedAt || intent.expiresAt.getTime() < Date.now()) return null;

  const paymentLink = paymentLinkSchema.parse(
    await stripeGet(`/payment_links/${encodeURIComponent(paymentLinkId)}`),
  );
  const expectedUrl = paymentLinkUrl(intent.plan);
  if (!paymentLink.active || canonicalPaymentLink(paymentLink.url) !== canonicalPaymentLink(expectedUrl))
    return { invalid: true as const };

  const subscriptionId = objectId(session.subscription);
  const subscription = subscriptionId
    ? subscriptionSchema.parse(await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`))
    : null;

  return {
    invalid: false as const,
    intent,
    subscription,
  };
}

export async function processStripeEvent(payload: unknown) {
  const event = eventSchema.parse(payload);

  let paymentLinkCheckout: Awaited<ReturnType<typeof resolvePaymentLinkCheckout>> = null;
  let parsedCheckout: z.infer<typeof checkoutSchema> | null = null;
  if (event.type === "checkout.session.completed") {
    parsedCheckout = checkoutSchema.parse(event.data.object);
    if (parsedCheckout.payment_link)
      paymentLinkCheckout = await resolvePaymentLinkCheckout(parsedCheckout);
  }

  return db().transaction(async (tx) => {
    const inserted = await tx.insert(stripeEvents).values({ id: event.id, type: event.type })
      .onConflictDoNothing().returning({ id: stripeEvents.id });
    if (!inserted.length) return { duplicate: true };

    if (event.type === "checkout.session.completed") {
      const session = parsedCheckout ?? checkoutSchema.parse(event.data.object);
      const customerId = objectId(session.customer);

      if (session.payment_link) {
        if (!paymentLinkCheckout || paymentLinkCheckout.invalid || !customerId)
          return { duplicate: false, ignored: true };

        const { intent, subscription } = paymentLinkCheckout;
        const subscriptionId = subscription?.id ?? objectId(session.subscription);
        await tx.insert(billingSubscriptions).values({
          userId: intent.userId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          plan: intent.plan,
          status: subscription?.status ?? "incomplete",
          currentPeriodEnd: subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: billingSubscriptions.userId,
          set: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            plan: intent.plan,
            status: subscription?.status ?? "incomplete",
            currentPeriodEnd: subscription?.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
            cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
            updatedAt: new Date(),
          },
        });

        await tx.update(billingCheckoutIntents).set({ consumedAt: new Date() })
          .where(eq(billingCheckoutIntents.id, intent.id));
        return { duplicate: false };
      }

      // Backward compatibility for sessions created by the old Checkout Session integration.
      const userId = session.client_reference_id ?? session.metadata.userId;
      const parsedPlan = planSchema.safeParse(session.metadata.plan);
      if (userId && customerId && parsedPlan.success && parsedPlan.data !== "free") {
        const existing = await tx.select().from(billingSubscriptions)
          .where(eq(billingSubscriptions.userId, userId)).limit(1);
        if (existing.length) {
          await tx.update(billingSubscriptions).set({
            stripeCustomerId: customerId,
            stripeSubscriptionId: objectId(session.subscription),
            plan: parsedPlan.data,
            updatedAt: new Date(),
          }).where(eq(billingSubscriptions.userId, userId));
        } else {
          await tx.insert(billingSubscriptions).values({
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: objectId(session.subscription),
            plan: parsedPlan.data,
            status: "incomplete",
          });
        }
      }
      return { duplicate: false };
    }

    if (event.type.startsWith("customer.subscription.")) {
      const subscription = subscriptionSchema.parse(event.data.object);
      const customerId = objectId(subscription.customer);
      let plan = planFromSubscription(subscription);
      let userId = subscription.metadata.userId;
      if (customerId) {
        const [existing] = await tx.select().from(billingSubscriptions)
          .where(eq(billingSubscriptions.stripeCustomerId, customerId));
        if (!userId) userId = existing?.userId;
        if (!plan && existing?.plan !== "free") plan = existing?.plan ?? null;
      }
      if (userId && customerId && plan) {
        await tx.insert(billingSubscriptions).values({
          userId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          plan,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: billingSubscriptions.userId,
          set: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            plan,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
            cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
            updatedAt: new Date(),
          },
        });
      }
    }

    return { duplicate: false };
  });
}
