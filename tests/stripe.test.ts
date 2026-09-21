import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@valostudy/config", () => ({
  config: () => ({
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_PLUS_PRICE_ID: "price_plus",
    STRIPE_PRO_PRICE_ID: "price_pro",
    BETTER_AUTH_URL: "http://localhost:3000",
  }),
}));

import { verifyStripeSignature } from "../apps/web/lib/stripe";

describe("Stripe webhook signatures", () => {
  it("accepts a current valid v1 signature and rejects tampering", () => {
    const raw = JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", "whsec_test_secret")
      .update(`${timestamp}.${raw}`)
      .digest("hex");

    expect(verifyStripeSignature(raw, `t=${timestamp},v1=${signature}`)).toBe(true);
    expect(verifyStripeSignature(raw + "x", `t=${timestamp},v1=${signature}`)).toBe(false);
    expect(verifyStripeSignature(raw, null)).toBe(false);
  });

  it("rejects signatures outside the replay tolerance", () => {
    const raw = "{}";
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const signature = createHmac("sha256", "whsec_test_secret")
      .update(`${timestamp}.${raw}`)
      .digest("hex");
    expect(verifyStripeSignature(raw, `t=${timestamp},v1=${signature}`)).toBe(false);
  });
});
