import Link from "next/link";

const docs = [
  {
    href: "/docs/mcp",
    kicker: "AI CLIENTS",
    title: "MCP",
    body: "ChatGPTやClaudeなどのMCPクライアントから、公開Studyの設定・prompt・フレーム証拠を直接取得します。",
  },
  {
    href: "/docs/api",
    kicker: "PRO AUTOMATION",
    title: "Bearer REST API",
    body: "Proユーザー向けのread-only API。自分のStudyとCoach Workspaceを外部ツールから取得できます。",
  },
  {
    href: "/docs/canonical-schema",
    kicker: "STABLE REPRESENTATION",
    title: "Canonical Schema",
    body: "VALORANT録画をAIやツールが共通して扱えるVCMRのcanonical representationとして読み出します。",
  },
] as const;

export default function DeveloperDocsPage() {
  return <main className="study-page docs-page">
    <div className="study-topbar">
      <Link className="back-link" href="/">← ValoStudy</Link>
      <span className="status-badge">DEVELOPER DOCS</span>
    </div>
    <header className="study-header docs-header">
      <p className="section-index">BUILD ON VALOSTUDY</p>
      <h1>Developer Docs</h1>
      <p>
        AIクライアントとの接続から、Pro向けBearer API、VCMR canonical dataまで。
        ValoStudyを外部ワークフローの互換レイヤーとして使うための入口です。
      </p>
    </header>

    <div className="docs-grid">
      {docs.map((doc) => <Link className="docs-card" href={doc.href} key={doc.href}>
        <span>{doc.kicker}</span>
        <h2>{doc.title}</h2>
        <p>{doc.body}</p>
        <strong>読む →</strong>
      </Link>)}
    </div>
  </main>;
}
