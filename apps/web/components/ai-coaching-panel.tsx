"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import styles from "./ai-coaching-panel.module.css";

type AiCoachingPanelProps = {
  studyId: string;
  mcpUrl: string;
  isPublic: boolean;
};

export function AiCoachingPanel({ studyId, mcpUrl, isPublic }: AiCoachingPanelProps) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [copied, setCopied] = useState<"mcp" | "prompt" | "error" | null>(null);

  const coachingPrompt = [
    `${studyId} をコーチングして。`,
    "get_studyでStudyを確認し、get_player_settingsとget_coaching_promptを読んだうえで、",
    "list_frames/get_frameを使って試合の序盤・中盤・終盤を広く確認して分析して。",
  ].join("");

  async function copy(value: string, kind: "mcp" | "prompt") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopied("error");
    }
  }

  return <section className={styles.panel} aria-labelledby="ai-coaching-title">
    <div className={styles.heading}>
      <div>
        <p className={styles.kicker}>AI COACHING</p>
        <h2 id="ai-coaching-title">AIで試合をコーチング</h2>
      </div>
      <p>
        ValoStudyをChatGPTに接続して、このStudyの設定・コーチング指示・フレームを
        MCP経由で直接読ませられます。
      </p>
    </div>

    <div className={styles.steps}>
      <article className={styles.step}>
        <span className={styles.stepNumber}>1</span>
        <div className={styles.stepBody}>
          <strong>ValoStudyをChatGPTに接続</strong>
          <p>初回だけMCPを登録します。すでに接続済みなら、この手順は飛ばせます。</p>
          <Button
            type="button"
            className="primary-button"
            aria-expanded={setupOpen}
            aria-controls="valostudy-mcp-setup"
            onClick={() => setSetupOpen((open) => !open)}
          >
            {setupOpen ? "セットアップを閉じる" : "ChatGPTに接続"}
          </Button>

          {setupOpen && <div className={styles.setup} id="valostudy-mcp-setup">
            <ol>
              <li>ChatGPTの Settings → Apps → Advanced Settings でDeveloper modeを有効にします。</li>
              <li>Apps → Create を開き、Endpointとして下のMCP URLを登録します。</li>
              <li>ツールをスキャンしてValoStudyを作成し、ツールが表示されたら接続完了です。</li>
            </ol>
            <div className={styles.copyRow}>
              <code>{mcpUrl}</code>
              <Button
                type="button"
                className="secondary-button"
                variant="outline"
                onClick={() => void copy(mcpUrl, "mcp")}
              >
                {copied === "mcp" ? "コピー済み" : "MCP URLをコピー"}
              </Button>
            </div>
            <a className={styles.chatgptLink} href="https://chatgpt.com/" target="_blank" rel="noreferrer">
              ChatGPTを開く <span aria-hidden="true">↗</span>
            </a>
          </div>}
        </div>
      </article>

      <article className={styles.step}>
        <span className={styles.stepNumber}>2</span>
        <div className={styles.stepBody}>
          <strong>コーチングプロンプトをコピー</strong>
          {isPublic
            ? <p>Study IDと、ValoStudy MCPを正しい順序で使う指示をまとめてコピーします。</p>
            : <p className={styles.warning}>
                このStudyはprivateです。現在のValoStudy MCPは公開Studyのみ参照できます。
                MCPでコーチングする場合は公開Studyを使用してください。
              </p>}
          <pre className={styles.promptPreview}>{coachingPrompt}</pre>
          <Button
            type="button"
            className="secondary-button"
            variant="outline"
            disabled={!isPublic}
            onClick={() => void copy(coachingPrompt, "prompt")}
          >
            {copied === "prompt" ? "コピー済み" : "コーチングプロンプトをコピー"}
          </Button>
        </div>
      </article>

      <article className={styles.step}>
        <span className={styles.stepNumber}>3</span>
        <div className={styles.stepBody}>
          <strong>ChatGPTへ送信</strong>
          <p>
            コピーしたプロンプトをChatGPTへ送れば、ValoStudy MCPから試合データを取得して
            コーチングを開始できます。
          </p>
          <a className={styles.openChatButton} href="https://chatgpt.com/" target="_blank" rel="noreferrer">
            ChatGPTを開く <span aria-hidden="true">↗</span>
          </a>
        </div>
      </article>
    </div>

    {copied === "error" &&
      <p className={styles.error} role="status">
        クリップボードへコピーできませんでした。URLまたはプロンプトを手動で選択してください。
      </p>}
  </section>;
}
