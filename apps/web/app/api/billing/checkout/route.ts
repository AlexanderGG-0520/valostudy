import { z } from "zod";
import { billingSubscriptions, db, eq, user } from "@valostudy/db";
import { handle, jsonBody, owner, HttpError } from "../../../../lib/http";
import { createCheckoutSession } from "../../../../lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const userId = await owner(request);
    const { plan } = z.object({ plan: z.enum(["plus", "pro"]) }).parse(await jsonBody(request));
    const [account] = await db().select().from(user).where(eq(user.id, userId));
    if (!account) throw new HttpError(404, "Account not found");
    const [billing] = await db().select().from(billingSubscriptions)
      .where(eq(billingSubscriptions.userId, userId));
    if (billing && ["active", "trialing", "past_due"].includes(billing.status))
      throw new HttpError(409, "Use Billing Portal to change an active paid plan");

    const url = await createCheckoutSession({
      userId,
      email: account.email,
      plan,
      customerId: billing?.stripeCustomerId,
    });
    return Response.json({ url });
  });
}
