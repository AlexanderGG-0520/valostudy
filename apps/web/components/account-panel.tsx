"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";

type PasskeyRow = {
  id: string;
  name?: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt?: Date | string | null;
  aaguid?: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AccountPanel() {
  const { data: session, isPending } = authClient.useSession();
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "PublicKeyCredential" in window);
  }, []);

  const refreshPasskeys = useCallback(async () => {
    const result = await authClient.passkey.listUserPasskeys();
    if (result.error) throw new Error(result.error.message);
    setPasskeys((result.data ?? []) as PasskeyRow[]);
  }, []);

  useEffect(() => {
    if (!session?.user.id) {
      setPasskeys([]);
      return;
    }
    void refreshPasskeys().catch((error) => setMessage(errorMessage(error, "パスキー一覧を取得できませんでした")));
  }, [session?.user.id, refreshPasskeys]);

  async function signInWithPasskey() {
    setBusy("signin");
    setMessage("");
    try {
      const result = await authClient.signIn.passkey({});
      if (result.error) throw new Error(result.error.message);
      window.location.reload();
    } catch (error) {
      setMessage(errorMessage(error, "パスキーログインに失敗しました"));
    } finally {
      setBusy(null);
    }
  }

  async function addPasskey() {
    setBusy("add");
    setMessage("");
    try {
      if (supported === false) throw new Error("このブラウザはパスキーに対応していません");
      const result = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      });
      if (result.error) throw new Error(result.error.message);
      setName("");
      setMessage("パスキーを追加しました");
      await refreshPasskeys();
    } catch (error) {
      setMessage(errorMessage(error, "パスキーの追加に失敗しました"));
    } finally {
      setBusy(null);
    }
  }

  async function removePasskey(id: string) {
    setBusy(id);
    setMessage("");
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) throw new Error(result.error.message);
      setMessage("パスキーを削除しました");
      await refreshPasskeys();
    } catch (error) {
      setMessage(errorMessage(error, "パスキーの削除に失敗しました"));
    } finally {
      setBusy(null);
    }
  }

  if (isPending) {
    return <section className="account-card"><p className="status-line">アカウント情報を確認しています…</p></section>;
  }

  if (!session) {
    return <section className="account-card">
      <div className="section-heading compact">
        <div>
          <p className="section-index">ACCOUNT</p>
          <h2>マイページにログイン</h2>
        </div>
        <p className="section-copy">登録済みのパスキーがあれば、パスワードを入力せずにログインできます。</p>
      </div>
      <Button
        className="primary-button passkey-action"
        disabled={busy !== null || supported === false}
        onClick={() => void signInWithPasskey()}
      >
        パスキーでログイン
      </Button>
      <p className="field-hint">
        {supported === false ? "このブラウザではWebAuthnを利用できません。" : "メールとパスワードでのログインはトップページから利用できます。"}
      </p>
      <p className="status-line" role="status">{message}</p>
    </section>;
  }

  return <div className="account-stack">
    <section className="account-card">
      <div className="section-heading compact">
        <div>
          <p className="section-index">PROFILE</p>
          <h2>{session.user.name}</h2>
        </div>
        <p className="section-copy">{session.user.email}</p>
      </div>
      <div className="account-actions">
        <span className="field-hint">アカウントIDや認証情報そのものは画面に表示しません。</span>
        <Button
          className="secondary-button"
          variant="outline"
          onClick={() => void authClient.signOut().then(() => { window.location.href = "/"; })}
        >
          ログアウト
        </Button>
      </div>
    </section>

    <section className="account-card">
      <div className="section-heading compact">
        <div>
          <p className="section-index">SECURITY · PASSKEY</p>
          <h2>パスキー</h2>
        </div>
        <p className="section-copy">
          Windows Hello、Android、iPhone、セキュリティキーなどに保存したパスキーでVALOSTUDYへログインできます。
        </p>
      </div>

      <div className="passkey-create">
        <label>
          <span className="field-label">パスキー名（任意）</span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={100}
            placeholder="例: Pixel 7 / Windows Hello"
            autoComplete="off"
          />
        </label>
        <Button
          className="primary-button passkey-action"
          disabled={busy !== null || supported === false}
          onClick={() => void addPasskey()}
        >
          この端末にパスキーを追加
        </Button>
      </div>

      <div className="passkey-list" aria-live="polite">
        {passkeys.length === 0 ? <div className="passkey-empty">
          <strong>登録済みパスキーはありません。</strong>
          <span>上のボタンから最初のパスキーを登録できます。</span>
        </div> : passkeys.map((item) => <div className="passkey-row" key={item.id}>
          <div>
            <strong>{item.name || "Passkey"}</strong>
            <div className="passkey-meta">
              <span>{item.deviceType === "multiDevice" ? "同期パスキー" : "この端末のパスキー"}</span>
              <span>{item.backedUp ? "バックアップ済み" : "端末保存"}</span>
              {item.createdAt && <span>{new Date(item.createdAt).toLocaleString("ja-JP")}</span>}
            </div>
          </div>
          <Button
            className="secondary-button danger-button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void removePasskey(item.id)}
            aria-label={`${item.name || "Passkey"}を削除`}
          >
            削除
          </Button>
        </div>)}
      </div>
      <p className="status-line" role="status">{message}</p>
    </section>
  </div>;
}
