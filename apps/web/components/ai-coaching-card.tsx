"use client";

import { useState } from "react";

type AiCoachingCardProps = {
  studyId: string;
  appUrl: string;
};

function coachingPrompt(studyId: string) {
  return `${studyId} をコーチングして。

ValoStudy MCPの get_study でStudyの状態を確認し、
get_player_settings と get_coaching_prompt を読み、
list_frames/get_frame を使って試合全体を広く確認したうえで、
改善点を具体的に分析してください。`;
}

export function AiCoachingCard({ studyId, appUrl }: AiCoachingCardProps) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const baseUrl = appUrl.replace(/\/$/, "");
  const mcpUrl = `${baseUrl}/mcp`;
  const studyUrl = `${baseUrl}/${studyId}`;
  const prompt = coachingPrompt(studyId);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopied(label);
    window.setTimeout(() => setCopied((current) => current === label ? null : current), 1800);
  }

  return <>
    <section className="study-card ai-coaching-card" aria-labelledby="ai-coaching-title">
      <div className="ai-coaching-heading">
        <div>
          <p className="eyebrow">AI COACHING</p>
          <h2 id="ai-coaching-title">AIにこの試合をコーチングしてもらう</h2>
        </div>
        <span className="ai-coaching-badge">2 STEPS</span>
      </div>

      <p className="ai-coaching-lead">
        初回だけValoStudyをChatGPTに接続したら、あとは試合ごとのプロンプトを送るだけです。
        MCPの細かい仕組みを知らなくても使えます。
      </p>

      <div className="ai-coaching-actions">
        <button className="ai-action primary" type="button" onClick={() => setSetupOpen(true)}>
          <span>01</span>
          <strong>ChatGPTにValoStudyを接続</strong>
          <small>初回のみ</small>
        </button>
        <button className="ai-action secondary" type="button" onClick={() => void copy(prompt, "prompt")}>
          <span>02</span>
          <strong>{copied === "prompt" ? "コピーしました ✓" : "コーチングプロンプトをコピー"}</strong>
          <small>このStudy用</small>
        </button>
      </div>

      <details className="ai-coaching-details">
        <summary>識別リンク・手動設定</summary>
        <div className="ai-detail-grid">
          <div>
            <span>Study URL</span>
            <code>{studyUrl}</code>
            <button type="button" onClick={() => void copy(studyUrl, "study")}>
              {copied === "study" ? "コピー済み ✓" : "コピー"}
            </button>
          </div>
          <div>
            <span>MCP URL</span>
            <code>{mcpUrl}</code>
            <button type="button" onClick={() => void copy(mcpUrl, "mcp")}>
              {copied === "mcp" ? "コピー済み ✓" : "コピー"}
            </button>
          </div>
        </div>
      </details>
    </section>

    {setupOpen && <div
      className="mcp-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setSetupOpen(false);
      }}
    >
      <section
        className="mcp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-setup-title"
      >
        <button className="mcp-modal-close" type="button" aria-label="閉じる" onClick={() => setSetupOpen(false)}>
          ×
        </button>

        <p className="eyebrow">ONE-TIME SETUP</p>
        <h2 id="mcp-setup-title">ChatGPTでValoStudyを使う</h2>
        <p className="mcp-modal-copy">
          ChatGPTのプラグイン設定からカスタムMCPを追加し、下のURLを登録してください。
        </p>

        <ol className="mcp-setup-steps">
          <li>
            <span>1</span>
            <div>
              <strong>ChatGPTを開く</strong>
              <p>プラグイン設定からカスタムMCPの追加画面を開きます。</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>ValoStudy MCPを登録</strong>
              <p>サーバーURLとして次のURLを貼り付けます。</p>
              <div className="mcp-url-row">
                <code>{mcpUrl}</code>
                <button type="button" onClick={() => void copy(mcpUrl, "modal-mcp")}>
                  {copied === "modal-mcp" ? "コピー済み ✓" : "URLをコピー"}
                </button>
              </div>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>この画面に戻ってプロンプトをコピー</strong>
              <p>接続は初回だけです。次回以降はStudyごとのプロンプトを送るだけで使えます。</p>
            </div>
          </li>
        </ol>

        <div className="mcp-modal-actions">
          <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPTを開く ↗</a>
          <button type="button" onClick={() => setSetupOpen(false)}>閉じる</button>
        </div>

        <details className="mcp-troubleshooting">
          <summary>AIがStudyを読み込めない場合</summary>
          <p>
            ValoStudy MCPは公開Studyのみ取得できます。Studyが公開設定になっていること、
            MCPがChatGPTで有効になっていることを確認してください。
          </p>
        </details>
      </section>
    </div>}
  </>;
}
