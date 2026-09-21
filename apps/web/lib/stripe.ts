import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "@valostudy/config";
import { billingSubscriptions, db, eq, stripeEvents } from "@valostudy/db";
import { planSchema, type Plan } from "@valostudy/schema";

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

export async function createCheckoutSession(input: {
  userId: string;
  email: string;
  plan: Exclude<Plan, "free">;
  customerId?: string | null;
}) {
  const c = stripeConfig();
  const priceId = input.plan === "plus" ? c.STRIPE_PLUS_PRICE_ID : c.STRIPE_PRO_PRICE_ID;
  if (!priceId) throw new Error(`Stripe ${input.plan} price is not configured`);
  const origin = new URL(c.BETTER_AUTH_URL).origin;
  const params = new URLSearchParams({
    mode: "subscription",
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancelled`,
    client_reference_id: input.userId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[userId]": input.userId,
    "metadata[plan]": input.plan,
    "subscription_data[metadata][userId]": input.userId,
    "subscription_data[metadata][plan]": input.plan,
    allow_promotion_codes: "true",
  });
  if (input.customerId) params.set("customer", input.customerId);
  else params.set("customer_email", input.email);
  const result = await stripeRequest("/checkout/sessions", params);
  if (typeof result.url !== "string") throw new Error("Stripe did not return a Checkout URL");
  return result.url;
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
  customer: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  subscription: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  client_reference_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional().default({}),
});

function objectId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function planFromSubscription(subscription: z.infer<typeof subscriptionSchema>): Exclude<Plan, "free"> | null {
  const metadataPlan = planSchema.safeParse(subscription.metadata.plan);
  if (metadataPlan.success && metadataPlan.data !== "free") return metadataPlan.data;
  const price = subscription.items?.data[0]?.price.id;
  const c = config();
  if (price && price === c.STRIPE_PLUS_PRICE_ID) return "plus";
  if (price && price === c.STRIPE_PRO_PRICE_ID) return "pro";
  return null;
}

export async function processStripeEvent(payload: unknown) {
  const event = eventSchema.parse(payload);
  return db().transaction(async (tx) => {
    const inserted = await tx.insert(stripeEvents).values({ id: event.id, type: event.type })
      .onConflictDoNothing().returning({ id: stripeEvents.id });
    if (!inserted.length) return { duplicate: true };

    if (event.type === "checkout.session.completed") {
      const session = checkoutSchema.parse(event.data.object);
      const userId = session.client_reference_id ?? session.metadata.userId;
      const parsedPlan = planSchema.safeParse(session.metadata.plan);
      const customerId = objectId(session.customer);
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
      const plan = planFromSubscription(subscription);
      let userId = subscription.metadata.userId;
      if (!userId && customerId) {
        const [existing] = await tx.select().from(billingSubscriptions)
          .where(eq(billingSubscriptions.stripeCustomerId, customerId));
        userId = existing?.userId;
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
