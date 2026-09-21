import { billingSubscriptions, db, eq } from "@valostudy/db";
import { handle, owner, HttpError } from "../../../../lib/http";
import { createPortalSession } from "../../../../lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const userId = await owner(request);
    const [billing] = await db().select().from(billingSubscriptions)
      .where(eq(billingSubscriptions.userId, userId));
    if (!billing?.stripeCustomerId) throw new HttpError(400, "No Stripe customer exists for this account");
    return Response.json({ url: await createPortalSession(billing.stripeCustomerId) });
  });
}
