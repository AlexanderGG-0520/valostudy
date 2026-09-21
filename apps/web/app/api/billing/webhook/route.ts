import { handle, HttpError } from "../../../../lib/http";
import { processStripeEvent, verifyStripeSignature } from "../../../../lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const raw = await request.text();
    if (raw.length > 256 * 1024) throw new HttpError(413, "Webhook too large");
    if (!verifyStripeSignature(raw, request.headers.get("stripe-signature")))
      throw new HttpError(400, "Invalid Stripe signature");
    await processStripeEvent(JSON.parse(raw) as unknown);
    return Response.json({ received: true });
  });
}
