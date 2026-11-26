"use client";

import Link from "next/link";
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

const planCopy: Record<Plan, { kicker: string; description: string }> = {
  free: { kicker: "START HERE", description: "日常的に試せる無料枠。" },
  plus: { kicker: "FOR PLAYERS", description: "個人プレイヤー向けの振り返り。" },
  pro: { kicker: "HIGH VOLUME", description: "高密度のVOD分析と外部ツール連携。" },
  coach: { kicker: "FOR COACHES", description: "複数プレイヤーの継続的なコーチング。" },
};

function features(plan: Plan) {
  const limits = PLAN_LIMITS[plan];
  return [
    limits.publicStudyLimitLabel,
    `最大${limits.maxFps} FPS · ${limits.maxVideoSeconds / 3600}時間`,
    `最大${limits.maxUploadBytes / 1024 ** 3} GiB · ${limits.maxFrames.toLocaleString("en-US")} frames`,
    limits.retentionDays === null ? "フレーム保持期限なし" : `フレーム${limits.retentionDays}日保持`,
    "Public / Private",
    ...(limits.compareLimit ? [`最大${limits.compareLimit} Study比較`] : []),
    ...(limits.clientLimit ? [`Coach Workspace · 最大${limits.clientLimit} clients`] : []),
    ...(limits.apiAccess ? ["Bearer API access"] : []),
    ...(plan !== "free" ? [plan === "coach" ? "Highest-priority processing" : "Priority processing"] : []),
  ];
}

function price(plan: Plan) {
  return `${PLAN_LIMITS[plan].priceUsdMonthly}`;
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
  const [billingResult, setBillingResult] = useState<{
    userId: string;
    billing: BillingStatus | null;
    error: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Plan | "portal" | null>(null);
  const sessionUserId = session?.user.id;
  const currentResult = sessionUserId && billingResult?.userId === sessionUserId ? billingResult : null;
  const currentBilling = currentResult?.billing ?? null;
  const billingError = currentResult?.error ?? "";
  const billingLoading = Boolean(sessionUserId && !currentResult);

  useEffect(() => {
    let active = true;
    if (!sessionUserId) return;

    void fetch("/api/billing/status", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as BillingStatus & { error?: string };
        if (!active) return;
        if (!response.ok) {
          setBillingResult({
            userId: sessionUserId,
            billing: null,
            error: data.error ?? `Plan status unavailable (HTTP ${response.status})`,
          });
          return;
        }
        setBillingResult({ userId: sessionUserId, billing: data, error: "" });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setBillingResult({
          userId: sessionUserId,
          billing: null,
          error: error instanceof Error ? error.message : "Plan status unavailable",
        });
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

  async function checkout(plan: Exclude<Plan, "free">) {
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
      {session && <div className="current-plan-summary" aria-live="polite">
        <span>CURRENT PLAN</span>
        {currentBilling ? <>
          <strong>{PLAN_LIMITS[currentBilling.plan].label}</strong>
          <p>
            {currentBilling.plan === "free" && !currentBilling.usage.canCreate && currentBilling.usage.nextAvailableAt
              ? `次のStudy: ${formatDate(currentBilling.usage.nextAvailableAt)}`
              : currentBilling.usage.displayLimit !== null
                ? `${currentBilling.usage.used} / ${currentBilling.usage.displayLimit} used · rolling 7 days`
                : currentBilling.usage.publicLimitLabel}
          </p>
          {currentBilling.entitlementSource === "developer"
            ? <small>Developer entitlement · billing不要</small>
            : currentBilling.subscription?.currentPeriodEnd && <small>
                {currentBilling.subscription.cancelAtPeriodEnd ? "終了予定" : "次回更新"}: {formatDate(currentBilling.subscription.currentPeriodEnd)}
              </small>}
        </> : billingLoading ? <>
          <strong>Checking…</strong>
          <p>現在のプランを確認しています。</p>
        </> : <>
          <strong>Unavailable</strong>
          <p>{billingError || "現在のプランを確認できませんでした。"}</p>
          <small>アップグレード操作はプラン確認が復旧するまで無効です。</small>
        </>}
      </div>}
    </div>

    <div className="pricing-grid">
      {(["free", "plus", "pro", "coach"] as const).map((plan) => {
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
            {features(plan).map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
          {PLAN_LIMITS[plan].apiAccess && <Link className="pricing-doc-link" href="/docs/api">Bearer API docs →</Link>}

          {plan === "free" ? <div className="plan-action-muted">
            {!session
              ? "アカウント作成で利用可能"
              : currentBilling
                ? (current ? "現在のプラン" : "Freeは常に利用可能")
                : billingLoading
                  ? "プラン確認中…"
                  : "プランを確認できません"}
          </div> : currentBilling?.entitlementSource === "developer" ? <div className="plan-action-muted">
            {current ? "Developer Coach · 課金不要" : "Developer Coach が有効"}
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
            disabled={!session || !currentBilling || busy !== null}
            onClick={() => void (currentBilling && currentBilling.plan !== "free" ? portal() : checkout(plan))}
          >
            {!session
              ? "ログイン後に選択"
              : billingLoading
                ? "プラン確認中…"
                : billingError || !currentBilling
                  ? "プランを確認できません"
                  : currentBilling.plan !== "free"
                    ? "Billing Portalでプラン変更"
                    : busy === plan
                      ? "Opening Stripe…"
                      : `${PLAN_LIMITS[plan].label}にアップグレード`}
          </Button>}
        </article>;
      })}
    </div>

    <p className="billing-footnote">
      * Coachは通常利用ではStudy数を表示上無制限とし、自動化された異常利用にだけfair-use保護を適用します。
      元動画は全プランでフレーム生成後に削除されます。
      ValoStudyの料金に外部AIの利用料金は含まれません。AI分析の自動実行も行いません。
    </p>
    {message && <p className="status-line billing-error" role="status">{message}</p>}
  </section>;
}
