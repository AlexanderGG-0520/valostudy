"use client";

import { useState, type FormEvent } from "react";
import { createAuthClient } from "better-auth/react";
import {
  MAX_EXTRACTED_FRAMES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_SECONDS,
  studyCreationSchema,
} from "@valostudy/schema";
import { Button } from "./ui/button";

const authClient = createAuthClient();

async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

function formatBytes(bytes: number) {
  if (!bytes) return "";
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
  const mib = bytes / 1024 ** 2;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

function mimeTypeFor(file: File) {
  switch (file.type) {
    case "video/mp4":
    case "video/webm":
    case "video/quicktime":
    case "video/x-matroska":
    case "video/x-msvideo":
      return file.type;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "mkv") return "video/x-matroska";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  if (extension === "avi") return "video/x-msvideo";
  return "video/mp4";
}

async function browserVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 5000);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

export function UploadForm() {
  const { data: session, isPending } = authClient.useSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [studyUrl, setStudyUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const input = {
        email: String(data.get("email")),
        password: String(data.get("password")),
        name: String(data.get("name")),
      };
      const result = data.get("mode") === "signup"
        ? await authClient.signUp.email(input)
        : await authClient.signIn.email(input);
      if (result.error) throw new Error(result.error.message);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "ログイン失敗");
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setStudyUrl("");
    setUploadProgress(0);
    const data = new FormData(e.currentTarget);

    try {
      const file = data.get("video");
      if (!(file instanceof File) || !file.size) throw new Error("試合録画を選択してください");
      if (file.size > MAX_UPLOAD_BYTES)
        throw new Error(`動画は最大 ${MAX_UPLOAD_BYTES / 1024 ** 3} GiB です`);

      const fps = Number(data.get("fps"));
      const duration = await browserVideoDuration(file);
      if (duration !== null) {
        if (duration > MAX_VIDEO_SECONDS)
          throw new Error("録画は2時間以内にしてください");
        if (Math.ceil(duration * fps) > MAX_EXTRACTED_FRAMES)
          throw new Error("この録画ではフレーム数が多すぎます。抽出間隔を長くしてください");
      }

      const input = studyCreationSchema.parse({
        player: {
          rank: data.get("rank"),
          sensitivity: {
            dpi: Number(data.get("dpi")),
            inGame: Number(data.get("inGame")),
          },
          videoSettings: {
            resolution: data.get("resolution"),
            refreshHz: Number(data.get("refreshHz")),
            fpsLimit: Number(data.get("fpsLimit")),
            vsync: data.get("vsync") === "on",
            displayMode: data.get("displayMode"),
            graphics: data.get("graphics"),
          },
          context: data.get("context"),
        },
        visibility: data.get("visibility"),
        video: { size: file.size, mimeType: mimeTypeFor(file) },
        processing: { fps },
      });

      const created = await jsonRequest("/api/studies", input) as {
        studyId: string;
        url: string;
        partBytes: number;
        partCount: number;
      };
      setStudyUrl(created.url);

      let nextPart = 1;
      let completedParts = 0;
      const uploadPart = async (part: number) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const signed = await jsonRequest(`/api/uploads/${created.studyId}/parts`, {
            partNumber: part,
          }) as { url: string };
          try {
            const response = await fetch(signed.url, {
              method: "PUT",
              body: file.slice((part - 1) * created.partBytes, part * created.partBytes),
            });
            if (response.ok) return;
          } catch {
            // Bounded retry re-signs this part.
          }
        }
        throw new Error(`パート ${part} のアップロードに失敗しました`);
      };

      const workerCount = Math.min(4, created.partCount);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        for (;;) {
          const part = nextPart++;
          if (part > created.partCount) return;
          await uploadPart(part);
          completedParts += 1;
          const percent = Math.round((completedParts / created.partCount) * 100);
          setUploadProgress(percent);
          setMessage(`試合録画をアップロード中 · ${percent}%`);
        }
      }));

      setMessage("アップロード完了。試合全体からフレームを生成しています。");
      await jsonRequest(`/api/uploads/${created.studyId}/complete`);
      setUploadProgress(100);
      setMessage("アップロード完了。処理後、元動画は自動で削除されます。");
    } catch (e) {
      setUploadProgress(0);
      setMessage(e instanceof Error ? e.message : "アップロード失敗");
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return <section className="auth-card">
      <div className="section-heading compact">
        <div>
          <p className="section-index">ACCOUNT</p>
          <h2>Studyを作成するにはログイン</h2>
        </div>
        <p className="section-copy">設定と録画をあなたのStudyとして安全に管理します。</p>
      </div>
      <form className="auth-grid" onSubmit={authenticate}>
        <label>
          <span className="field-label">操作</span>
          <select name="mode">
            <option value="signin">ログイン</option>
            <option value="signup">新規登録</option>
          </select>
        </label>
        <label>
          <span className="field-label">表示名</span>
          <input name="name" defaultValue="Player" required maxLength={100} autoComplete="name" />
        </label>
        <label>
          <span className="field-label">メール</span>
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          <span className="field-label">パスワード（12文字以上）</span>
          <input name="password" type="password" required minLength={12} autoComplete="current-password" />
        </label>
        <div className="form-actions">
          <Button className="primary-button" disabled={busy || isPending}>続ける</Button>
        </div>
      </form>
      <p className="status-line" role="status">{message}</p>
    </section>;
  }

  return <>
    <div className="session-bar">
      <div>
        <span className="session-label">SIGNED IN</span>
        <strong>{session.user.email}</strong>
      </div>
      <Button
        className="secondary-button"
        variant="outline"
        disabled={busy}
        onClick={() => void authClient.signOut()}
      >
        ログアウト
      </Button>
    </div>

    <form className="study-form" onSubmit={upload}>
      <fieldset className="study-section" disabled={busy}>
        <legend><span>01</span> プレイヤー設定</legend>
        <div className="section-heading">
          <div>
            <h2>環境を、推測ではなく証拠として残す。</h2>
          </div>
          <p className="section-copy">センシ、描画設定、現在の課題まで。AIがプレイだけを見て誤読しないための前提情報です。</p>
        </div>

        <div className="field-grid two-columns">
          <label>
            <span className="field-label">現在のランク</span>
            <select name="rank" defaultValue="Platinum 3">
              {["Unranked", ...["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"]
                .flatMap((rank) => [1, 2, 3].map((division) => `${rank} ${division}`)), "Radiant"]
                .map((rank) => <option key={rank}>{rank}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">DPI</span>
            <input name="dpi" type="number" min={50} max={64000} defaultValue={1600} required />
          </label>
          <label>
            <span className="field-label">ゲーム内センシ</span>
            <input name="inGame" type="number" min={0.001} max={20} step="any" defaultValue={0.1} required />
          </label>
          <label>
            <span className="field-label">解像度</span>
            <input name="resolution" defaultValue="1920x1080" required pattern="[1-9][0-9]{2,3}x[1-9][0-9]{2,3}" />
          </label>
          <label>
            <span className="field-label">リフレッシュレート (Hz)</span>
            <input name="refreshHz" type="number" min={30} max={1000} defaultValue={144} required />
          </label>
          <label>
            <span className="field-label">FPS上限（0 = 無制限）</span>
            <input name="fpsLimit" type="number" min={0} max={2000} defaultValue={0} required />
          </label>
          <label>
            <span className="field-label">V-Sync</span>
            <select name="vsync">
              <option value="off">OFF</option>
              <option value="on">ON</option>
            </select>
          </label>
          <label>
            <span className="field-label">表示モード</span>
            <select name="displayMode">
              <option value="fullscreen">Fullscreen</option>
              <option value="borderless">Borderless</option>
              <option value="windowed">Windowed</option>
            </select>
          </label>
        </div>

        <label>
          <span className="field-label">画質・Reflexなど</span>
          <input
            name="graphics"
            placeholder="例: 全低 / Reflex ON+Boost / G-SYNC ON"
            required
            maxLength={1000}
          />
        </label>
        <label>
          <span className="field-label">マップ・エージェント・状況・見てほしい点</span>
          <textarea
            name="context"
            rows={4}
            maxLength={6000}
            placeholder="例: アセント / クローヴ。撃ち合い、クロスヘアプレイスメント、フラッシュ回避を重点的に見てほしい。"
          />
        </label>
      </fieldset>

      <fieldset className="study-section upload-section" disabled={busy}>
        <legend><span>02</span> 試合録画</legend>
        <div className="section-heading">
          <div>
            <h2>切り抜きではなく、試合全体を見る。</h2>
          </div>
          <p className="section-copy">開始秒・終了秒の指定はありません。録画の先頭から末尾までをサンプリングします。</p>
        </div>

        <label className="file-field">
          <span className="field-label">試合全体の録画（最大16 GiB）</span>
          <input
            name="video"
            type="file"
            accept=".mp4,.mkv,.mov,.webm,.avi"
            required
            onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
          />
          <span className="file-meta">
            {selectedFile
              ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}`
              : "MP4 / MKV / MOV / WebM / AVI · 最大2時間"}
          </span>
        </label>

        <div className="retention-note">
          <span className="retention-mark">TEMPORARY SOURCE</span>
          <div>
            <strong>元動画は保存し続けません。</strong>
            <p>フレームの生成と保存が完了した直後に、アップロードした試合録画をオブジェクトストレージから削除します。</p>
          </div>
        </div>

        <div className="field-grid two-columns">
          <label>
            <span className="field-label">フレーム抽出間隔</span>
            <select name="fps" defaultValue="0.5">
              <option value="0.25">4秒ごと · 軽量</option>
              <option value="0.5">2秒ごと · 推奨</option>
              <option value="1">1秒ごと · 高密度</option>
            </select>
            <span className="field-hint">最大 {MAX_EXTRACTED_FRAMES.toLocaleString()} フレーム。長い録画では間隔を長くしてください。</span>
          </label>
          <label>
            <span className="field-label">公開範囲</span>
            <select name="visibility">
              <option value="private">非公開 · 自分のみ</option>
              <option value="public">公開 · AIがログインなしで取得可能</option>
            </select>
            <span className="field-hint">公開Studyではフレーム・設定・状況メモをURLから閲覧できます。</span>
          </label>
        </div>

        {busy && uploadProgress > 0 && <div className="progress-wrap" aria-label="アップロード進捗">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
          <span>{uploadProgress}%</span>
        </div>}

        <div className="submit-row">
          <div>
            <span className="submit-kicker">READY WHEN YOU ARE</span>
            <p>Study作成後、ブラウザからストレージへ直接アップロードします。</p>
          </div>
          <Button className="primary-button submit-button" disabled={busy}>
            {busy ? "処理中…" : "試合全体をStudyにする"}
          </Button>
        </div>
      </fieldset>
    </form>

    <p className="status-line" role="status">{message}</p>
    {studyUrl && <a className="study-link" href={studyUrl}>Studyを開く <span>→</span></a>}
  </>;
}
