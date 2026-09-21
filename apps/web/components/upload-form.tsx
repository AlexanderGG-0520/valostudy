"use client";
import { useState, type FormEvent } from "react";
import { createAuthClient } from "better-auth/react";
import { studyCreationSchema } from "@valostudy/schema";
import { Button } from "./ui/button";
const authClient = createAuthClient();
async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Request failed");
  return json;
}
export function UploadForm() {
  const { data: session, isPending } = authClient.useSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [studyUrl, setStudyUrl] = useState("");
  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true); setMessage("");
    try {
      const input = { email: String(data.get("email")), password: String(data.get("password")), name: String(data.get("name")) };
      const result = data.get("mode") === "signup" ? await authClient.signUp.email(input) : await authClient.signIn.email(input);
      if (result.error) throw new Error(result.error.message);
    } catch (e) { setMessage(e instanceof Error ? e.message : "ログイン失敗"); }
    finally { setBusy(false); }
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage(""); setStudyUrl("");
    const data = new FormData(e.currentTarget);
    try {
      const file = data.get("video");
      if (!(file instanceof File) || !file.size) throw new Error("動画を選択してください");
      const input = studyCreationSchema.parse({
        player: { rank: data.get("rank"), sensitivity: { dpi: Number(data.get("dpi")), inGame: Number(data.get("inGame")) },
          videoSettings: { resolution: data.get("resolution"), refreshHz: Number(data.get("refreshHz")),
            fpsLimit: Number(data.get("fpsLimit")), vsync: data.get("vsync") === "on",
            displayMode: data.get("displayMode"), graphics: data.get("graphics") }, context: data.get("context") },
        visibility: data.get("visibility"), video: { size: file.size, mimeType: file.type || "video/mp4" },
        processing: { startSeconds: Number(data.get("start")), durationSeconds: Number(data.get("duration")), fps: Number(data.get("fps")) },
      });
      const created = await jsonRequest("/api/studies", input) as { studyId: string; url: string; partBytes: number; partCount: number };
      setStudyUrl(created.url);
      for (let part = 1; part <= created.partCount; part++) {
        setMessage(`アップロード ${part} / ${created.partCount}`);
        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const signed = await jsonRequest(`/api/uploads/${created.studyId}/parts`, { partNumber: part }) as { url: string };
          try {
            const response = await fetch(signed.url, { method: "PUT", body: file.slice((part - 1) * created.partBytes, part * created.partBytes) });
            if (response.ok) { success = true; break; }
          } catch { /* Bounded retry re-signs this part. */ }
        }
        if (!success) throw new Error("アップロードに失敗しました。ストレージのCORS設定と接続を確認してください");
      }
      await jsonRequest(`/api/uploads/${created.studyId}/complete`);
      setMessage("アップロード完了。Workerが処理します。Studyを開いて進捗を確認してください。");
    } catch (e) { setMessage(e instanceof Error ? e.message : "アップロード失敗"); }
    finally { setBusy(false); }
  }
  return <>
    {!session ? <section><h2>ログイン / 新規登録</h2><form onSubmit={authenticate}>
      <label>操作<select name="mode"><option value="signin">ログイン</option><option value="signup">新規登録</option></select></label>
      <label>表示名<input name="name" defaultValue="Player" required maxLength={100} autoComplete="name" /></label>
      <label>メール<input name="email" type="email" required autoComplete="email" /></label>
      <label>パスワード（12文字以上）<input name="password" type="password" required minLength={12} autoComplete="current-password" /></label>
      <Button disabled={busy || isPending}>続ける</Button></form></section>
      : <><p>{session.user.email}</p><Button variant="outline" disabled={busy} onClick={() => void authClient.signOut()}>ログアウト</Button>
      <form onSubmit={upload}><fieldset disabled={busy}><legend>01 / プレイヤー設定</legend>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <label>現在のランク<select name="rank" defaultValue="Platinum 3">
            {["Unranked", ...["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"].flatMap((r) => [1,2,3].map((d) => `${r} ${d}`)), "Radiant"].map((r) => <option key={r}>{r}</option>)}
          </select></label>
          <label>DPI<input name="dpi" type="number" min={50} max={64000} defaultValue={1600} required /></label>
          <label>ゲーム内センシ<input name="inGame" type="number" min={0.001} max={20} step="any" defaultValue={0.1} required /></label>
          <label>解像度<input name="resolution" defaultValue="1920x1080" required pattern="[1-9][0-9]{2,3}x[1-9][0-9]{2,3}" /></label>
          <label>リフレッシュレート (Hz)<input name="refreshHz" type="number" min={30} max={1000} defaultValue={144} required /></label>
          <label>FPS上限（0 = 無制限）<input name="fpsLimit" type="number" min={0} max={2000} defaultValue={0} required /></label>
          <label>V-Sync<select name="vsync"><option value="off">OFF</option><option value="on">ON</option></select></label>
          <label>表示モード<select name="displayMode"><option value="fullscreen">fullscreen</option><option value="borderless">borderless</option><option value="windowed">windowed</option></select></label>
        </div>
        <label>画質・Reflexなど<input name="graphics" placeholder="全低 / Reflex ON" required maxLength={1000} /></label>
        <label>マップ・エージェント・状況・見てほしい点<textarea name="context" maxLength={6000} /></label>
      </fieldset><fieldset disabled={busy}><legend>02 / 動画と抽出区間</legend>
        <label>動画（最大4 GiB）<input name="video" type="file" accept=".mp4,.mkv,.mov,.webm,.avi" required /></label>
        <div className="grid gap-x-6 sm:grid-cols-3">
          <label>開始秒<input name="start" type="number" min={0} max={28800} step="any" defaultValue={0} required /></label>
          <label>区間秒（最大120）<input name="duration" type="number" min={1} max={120} step="any" defaultValue={20} required /></label>
          <label>抽出FPS<select name="fps" defaultValue="2"><option>0.5</option><option>1</option><option>2</option><option>5</option></select></label>
        </div>
        <label>公開範囲<select name="visibility"><option value="private">非公開（自分のみ）</option><option value="public">公開（AIがログインなしで取得可能）</option></select></label>
        <p>公開Studyはフレーム・設定・状況メモを誰でも閲覧できます。IDは認証用の秘密ではありません。</p>
        <Button disabled={busy}>Studyを作成してアップロード</Button>
      </fieldset></form></>}
    <p role="status">{message}</p>{studyUrl && <a href={studyUrl}>Studyを開く → {studyUrl}</a>}
  </>;
}
