"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import type { Plan } from "@valostudy/schema";
import { Button } from "./ui/button";

const authClient = createAuthClient();

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function ProApiPanel() {
  const { data: session } = authClient.useSession();
  const sessionUserId = session?.user.id;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!sessionUserId) return;
    const [billingResponse, keysResponse] = await Promise.all([
      fetch("/api/billing/status", { cache: "no-store" }),
      fetch("/api/api-keys", { cache: "no-store" }),
    ]);
    if (billingResponse.ok) {
      const billing = await billingResponse.json() as { plan: Plan };
      setPlan(billing.plan);
    }
    if (keysResponse.ok) {
      const result = await keysResponse.json() as { keys: ApiKeyRow[] };
      setKeys(result.keys);
    }
  }

  useEffect(() => {
    if (!sessionUserId) return;
    let active = true;
    void Promise.all([
      fetch("/api/billing/status", { cache: "no-store" }),
      fetch("/api/api-keys", { cache: "no-store" }),
    ]).then(async ([billingResponse, keysResponse]) => {
      if (!active) return;
      if (billingResponse.ok) setPlan(((await billingResponse.json()) as { plan: Plan }).plan);
      if (keysResponse.ok) setKeys(((await keysResponse.json()) as { keys: ApiKeyRow[] }).keys);
    });
    return () => { active = false; };
  }, [sessionUserId]);

  if (!sessionUserId || plan !== "pro") return null;

  async function createKey() {
    setBusy(true);
    setMessage("");
    setSecret("");
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "ValoStudy API" }),
      });
      const body = await response.json() as { secret?: string; error?: string };
      if (!response.ok || !body.secret) throw new Error(body.error ?? "API key creation failed");
      setSecret(body.secret);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "APIキーを発行できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "API key revoke failed");
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "APIキーを無効化できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return <section className="api-section">
    <div className="section-heading compact">
      <div>
        <p className="section-index">PRO API</p>
        <h2>自分のStudyを外部ツールから読む。</h2>
      </div>
      <p className="section-copy">
        Bearer API keyでStudy一覧とprivate manifestを取得できます。キーは発行時に一度だけ表示します。{" "}
        <Link className="inline-doc-link" href="/docs/api">API docs →</Link>
      </p>
    </div>

    <div className="api-actions">
      <Button type="button" className="primary-button" disabled={busy || keys.filter((key) => !key.revokedAt).length >= 5}
        onClick={() => void createKey()}>
        {busy ? "Working…" : "APIキーを発行"}
      </Button>
      <code>GET /api/v1/studies</code>
      <code>GET /api/v1/studies/:id/manifest</code>
      <code>GET /api/v1/clients</code>
      <code>GET /api/v1/clients/:id/manifest</code>
    </div>

    {secret && <div className="api-secret">
      <strong>このキーは再表示されません</strong>
      <code>{secret}</code>
      <Button type="button" className="secondary-button" variant="outline"
        onClick={() => void navigator.clipboard.writeText(secret)}>
        Copy
      </Button>
    </div>}

    <div className="api-key-list">
      {keys.filter((key) => !key.revokedAt).map((key) => <div key={key.id}>
        <span><strong>{key.name}</strong><small>{key.prefix}…</small></span>
        <Button type="button" className="secondary-button" variant="outline" disabled={busy}
          onClick={() => void revoke(key.id)}>Revoke</Button>
      </div>)}
    </div>
    {message && <p className="status-line billing-error" role="status">{message}</p>}
  </section>;
}
