import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: vi.fn(),
}));

vi.mock("@valostudy/config", () => ({
  config: () => ({
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_PLUS_PRICE_ID: "price_plus",
    STRIPE_PRO_PRICE_ID: "price_pro",
    STRIPE_PLUS_PAYMENT_LINK_URL: "https://buy.stripe.com/plus_test",
    STRIPE_PRO_PAYMENT_LINK_URL: "https://buy.stripe.com/pro_test",
    BETTER_AUTH_URL: "http://localhost:3000",
  }),
}));

vi.mock("@valostudy/db", async (original) => ({
  ...await original<typeof import("@valostudy/db")>(),
  db: () => ({
    insert: vi.fn(() => ({ values: state.values })),
  }),
}));

import {
  createPaymentLinkCheckout,
  verifyStripeSignature,
} from "../apps/web/lib/stripe";

beforeEach(() => {
  vi.resetAllMocks();
  state.values.mockResolvedValue([]);
});

describe("Stripe Payment Links", () => {
  it("binds an authenticated user to the configured Plus link with an opaque intent", async () => {
    const url = new URL(await createPaymentLinkCheckout({
      userId: "user-123",
      email: "player@example.test",
      plan: "plus",
    }));

    expect(`${url.origin}${url.pathname}`).toBe("https://buy.stripe.com/plus_test");
    expect(url.searchParams.get("prefilled_email")).toBe("player@example.test");
    expect(url.searchParams.get("client_reference_id")).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(state.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-123",
      plan: "plus",
      expiresAt: expect.any(Date),
    }));
  });

  it("uses the configured Pro Payment Link for Pro upgrades", async () => {
    const url = new URL(await createPaymentLinkCheckout({
      userId: "user-123",
      email: "player@example.test",
      plan: "pro",
    }));
    expect(`${url.origin}${url.pathname}`).toBe("https://buy.stripe.com/pro_test");
  });
});

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
