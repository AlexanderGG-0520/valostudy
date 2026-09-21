"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import type { Plan } from "@valostudy/schema";

type PasskeyRow = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string | Date | null;
};

type BillingStatus = {
  plan: Plan;
  entitlementSource: "free" | "stripe" | "developer";
};

function formatDate(value: string | Date | null) {
  if (!value) return "不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function MyPageClient() {
  const { data: session } = authClient.useSession();
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [plan, setPlan] = useState<BillingStatus | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [passkeyResult, billingResponse] = await Promise.all([
      authClient.passkey.listUserPasskeys(),
      fetch("/api/billing/status", { cache: "no-store" }),
    ]);
    if (passkeyResult.error) {
      setMessage(passkeyResult.error.message);
    } else {
      setPasskeys((passkeyResult.data ?? []) as PasskeyRow[]);
    }
    if (billingResponse.ok) setPlan(await billingResponse.json() as BillingStatus);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      });
      if (result.error) throw new Error(result.error.message);
      setName("");
      setMessage("パスキーを追加しました。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "パスキーを追加できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) throw new Error(result.error.message);
      setMessage("パスキーを削除しました。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "パスキーを削除できませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return <>
    <section className="account-section">
      <div className="section-heading compact">
        <div>
          <p className="section-index">ACCOUNT</p>
          <h2>アカウント</h2>
        </div>
        <p className="section-copy">登録情報と現在のプランを確認できます。</p>
      </div>
      <div className="account-info-grid">
        <div><span>表示名</span><strong>{session.user.name}</strong></div>
        <div><span>メール</span><strong>{session.user.email}</strong></div>
        <div><span>メール認証</span><strong>{session.user.emailVerified ? "認証済み" : "未認証"}</strong></div>
        <div><span>プラン</span><strong>{plan?.plan?.toUpperCase() ?? "確認中…"}</strong></div>
      </div>
    </section>

    <section className="account-section">
      <div className="section-heading compact">
        <div>
          <p className="section-index">PASSKEYS</p>
          <h2>パスキー</h2>
        </div>
        <p className="section-copy">端末の生体認証、PIN、セキュリティキーを使ってパスワードなしでログインできます。</p>
      </div>

      <div className="passkey-create">
        <label>
          <span className="field-label">パスキー名（任意）</span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="例: Windows Hello / Pixel 7"
            maxLength={100}
          />
        </label>
        <Button className="primary-button" type="button" disabled={busy} onClick={() => void addPasskey()}>
          {busy ? "処理中…" : "この端末にパスキーを追加"}
        </Button>
      </div>

      <div className="passkey-list">
        {passkeys.length === 0 ? <p className="empty-library">登録済みパスキーはありません。</p> : passkeys.map((item) => <div key={item.id}>
          <span>
            <strong>{item.name || "Passkey"}</strong>
            <small>{item.deviceType} · {item.backedUp ? "同期済み" : "端末保存"} · {formatDate(item.createdAt)}</small>
          </span>
          <Button className="secondary-button" variant="outline" type="button" disabled={busy}
            onClick={() => void removePasskey(item.id)}>
            削除
          </Button>
        </div>)}
      </div>
      {message && <p className="status-line" role="status">{message}</p>}
    </section>

    <section className="account-section account-danger">
      <div>
        <p className="section-index">SESSION</p>
        <h2>ログアウト</h2>
      </div>
      <Button className="secondary-button" variant="outline" type="button"
        onClick={() => void authClient.signOut({ fetchOptions: { onSuccess: () => { window.location.href = "/"; } } })}>
        ログアウト
      </Button>
    </section>
  </>;
}
