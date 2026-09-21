"use client";

import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { PLAN_LIMITS, type Plan } from "@valostudy/schema";
import { Button } from "./ui/button";

const authClient = createAuthClient();

type BillingStatus = {
  plan: Plan;
  entitlementSource: "free" | "stripe" | "developer";
  usage: {
    used: number;
    canCreate: boolean;
    nextAvailableAt: string | null;
    publicLimitLabel: string;
    displayLimit: number | null;
  };
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
  } | null;
};

const planCopy: Record<Plan, { kicker: string; description: string; features: string[] }> = {
  free: {
    kicker: "START HERE",
    description: "週末だけではなく、日常的に試せる無料枠。",
    features: [
      "1 Study / 6時間クールダウン",
      "最大1 FPS · 2時間",
      "最大16 GiB",
      "フレーム30日保持",
      "Public / Private",
    ],
  },
  plus: {
    kicker: "FOR PLAYERS",
    description: "日常的にランクを振り返る個人プレイヤー向け。",
    features: [
      "30 Studies / rolling 7 days",
      "最大2 FPS · 2時間",
      "最大32 GiB",
      "フレーム1年保持",
      "最大20 Study比較",
      "Priority processing",
    ],
  },
  pro: {
    kicker: "HIGH VOLUME",
    description: "コーチングや大量VOD処理まで想定した最上位枠。",
    features: [
      "Unlimited Studies*",
      "最大5 FPS · 4時間",
      "最大64 GiB",
      "フレーム保持期限なし",
      "最大100 Study比較",
      "Coach Workspace · 最大100 clients",
      "Bearer API access",
      "Highest-priority processing",
    ],
  },
};

function price(plan: Plan) {
  if (plan === "free") return "$0";
  return plan === "plus" ? "$20" : "$200";
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function BillingPanel() {
  const { data: session } = authClient.useSession();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Plan | "portal" | null>(null);
  const sessionUserId = session?.user.id;
  const currentBilling = sessionUserId ? billing : null;

  useEffect(() => {
    let active = true;
    if (!sessionUserId) return;
    void fetch("/api/billing/status", { cache: "no-store" }).then(async (response) => {
      if (active && response.ok) setBilling(await response.json() as BillingStatus);
    });
    return () => { active = false; };
  }, [sessionUserId]);

  async function post(url: string, body?: unknown) {
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await response.json() as { url?: string; error?: string };
    if (!response.ok || !data.url) throw new Error(data.error ?? "Billing request failed");
    window.location.assign(data.url);
  }

  async function checkout(plan: "plus" | "pro") {
    setBusy(plan);
    try {
      await post("/api/billing/checkout", { plan });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkoutを開始できませんでした");
      setBusy(null);
    }
  }

  async function portal() {
    setBusy("portal");
    try {
      await post("/api/billing/portal");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Billing Portalを開けませんでした");
      setBusy(null);
    }
  }

  return <section className="billing-section" aria-labelledby="plans-heading">
    <div className="billing-heading">
      <div>
        <p className="section-index">PLANS & BILLING</p>
        <h2 id="plans-heading">使い方に合わせて、処理枠を広げる。</h2>
      </div>
      {currentBilling && <div className="current-plan-summary">
        <span>CURRENT PLAN</span>
        <strong>{PLAN_LIMITS[currentBilling.plan].label}</strong>
        <p>
          {currentBilling.plan === "free" && !currentBilling.usage.canCreate && currentBilling.usage.nextAvailableAt
            ? `次のStudy: ${formatDate(currentBilling.usage.nextAvailableAt)}`
            : currentBilling.plan === "plus"
              ? `${currentBilling.usage.used} / 30 used · rolling 7 days`
              : currentBilling.usage.publicLimitLabel}
        </p>
        {currentBilling.entitlementSource === "developer"
          ? <small>Developer entitlement · billing不要</small>
          : currentBilling.subscription?.currentPeriodEnd && <small>
              {currentBilling.subscription.cancelAtPeriodEnd ? "終了予定" : "次回更新"}: {formatDate(currentBilling.subscription.currentPeriodEnd)}
            </small>}
      </div>}
    </div>

    <div className="pricing-grid">
      {(["free", "plus", "pro"] as const).map((plan) => {
        const current = currentBilling?.plan === plan;
        const copy = planCopy[plan];
        return <article className={`pricing-card ${plan === "plus" ? "featured" : ""}`} key={plan}>
          <div className="pricing-topline">
            <span>{copy.kicker}</span>
            {current && <strong className="current-plan-badge">CURRENT</strong>}
          </div>
          <h3>{PLAN_LIMITS[plan].label}</h3>
          <div className="price-line">
            <strong>{price(plan)}</strong>
            <span>/ month</span>
          </div>
          <p className="pricing-description">{copy.description}</p>
          <ul>
            {copy.features.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>

          {plan === "free" ? <div className="plan-action-muted">
            {session ? (current ? "現在のプラン" : "Freeは常に利用可能") : "アカウント作成で利用可能"}
          </div> : currentBilling?.entitlementSource === "developer" ? <div className="plan-action-muted">
            {current ? "Developer Pro · 課金不要" : "Developer Pro が有効"}
          </div> : current ? (currentBilling?.subscription?.hasCustomer ? <Button
            type="button"
            className="secondary-button pricing-button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void portal()}
          >
            {busy === "portal" ? "Opening…" : "支払い・解約を管理"}
          </Button> : <div className="plan-action-muted">現在のプラン</div>) : <Button
            type="button"
            className="primary-button pricing-button"
            disabled={!session || busy !== null}
            onClick={() => void (currentBilling && currentBilling.plan !== "free" ? portal() : checkout(plan))}
          >
            {!session
              ? "ログイン後に選択"
              : currentBilling && currentBilling.plan !== "free"
                ? "Billing Portalでプラン変更"
                : busy === plan
                  ? "Opening Stripe…"
                  : `${PLAN_LIMITS[plan].label}にアップグレード`}
          </Button>}
        </article>;
      })}
    </div>

    <p className="billing-footnote">
      * Proは通常利用ではStudy数を表示上無制限とし、自動化された異常利用にだけfair-use保護を適用します。
      元動画は全プランでフレーム生成後に削除されます。
    </p>
    {message && <p className="status-line billing-error" role="status">{message}</p>}
  </section>;
}
