import Link from "next/link";

const tools = [
  ["get_study", "Study状態・frame count・canonical resource URLを確認"],
  ["get_player_settings", "rank・sensitivity・video settings・contextを取得"],
  ["get_coaching_prompt", "Study作成時に固定されたcoaching promptを取得"],
  ["list_frames", "試合全体または時間範囲からframe metadataを列挙"],
  ["get_frame", "選択した実フレーム画像をAIクライアントへ直接返す"],
] as const;

export default function McpDocsPage() {
  return <main className="study-page docs-page">
    <div className="study-topbar">
      <Link className="back-link" href="/docs">← Developer Docs</Link>
      <span className="status-badge">PUBLIC · NO AUTH</span>
    </div>
    <header className="study-header docs-header">
      <p className="section-index">MODEL CONTEXT PROTOCOL</p>
      <h1>AIにStudyを直接読ませる。</h1>
      <p>
        ValoStudy MCPは公開Study専用のread-only serverです。AIクライアントはURLを推測してクロールする代わりに、
        Study設定・prompt・時系列フレームを構造化されたtoolとして取得できます。
      </p>
    </header>

    <section className="docs-content-card">
      <h2>Endpoint</h2>
      <pre><code>https://valostudy.alec-ofc.com/mcp</code></pre>
      <p>公開Studyのみ対象です。private・未完了・期限切れのframe evidenceはMCPから公開されません。</p>
    </section>

    <section className="docs-content-card">
      <h2>Recommended flow</h2>
      <ol className="docs-steps">
        <li><strong>get_study</strong> でStudyと利用可能な証拠を確認する</li>
        <li><strong>get_player_settings</strong> と <strong>get_coaching_prompt</strong> を読む</li>
        <li><strong>list_frames</strong> で序盤・中盤・終盤を広くサンプリングする</li>
        <li>判断に必要なframeを <strong>get_frame</strong> で取得して分析する</li>
      </ol>
    </section>

    <section className="docs-content-card">
      <h2>Tools</h2>
      <div className="endpoint-list">
        {tools.map(([name, description]) => <div key={name}>
          <code>TOOL</code>
          <strong>{name}</strong>
          <span>{description}</span>
        </div>)}
      </div>
    </section>
  </main>;
}
