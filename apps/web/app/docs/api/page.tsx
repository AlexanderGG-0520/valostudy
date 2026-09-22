import Link from "next/link";

const endpoints = [
  ["GET", "/api/v1/studies", "自分が所有するStudy一覧"],
  ["GET", "/api/v1/studies/:id/manifest", "自分のStudyのprivate manifest"],
  ["GET", "/api/v1/studies/:id/canonical", "自分のStudyのVCMR canonical representation"],
  ["GET", "/api/v1/clients", "Coach Workspaceのclient一覧"],
  ["GET", "/api/v1/clients/:id/manifest", "clientに紐づくStudy manifest"],
] as const;

export default function ApiDocsPage() {
  return <main className="study-page docs-page">
    <div className="study-topbar">
      <Link className="back-link" href="/docs">← Developer Docs</Link>
      <span className="status-badge">PRO · READ ONLY</span>
    </div>
    <header className="study-header docs-header">
      <p className="section-index">BEARER REST API</p>
      <h1>外部ツールからStudyを読む。</h1>
      <p>
        Pro向けのread-only APIです。ValoStudyで発行したAPI keyをAuthorizationヘッダーに渡し、
        自分のStudyやCoach Workspaceを自動化ワークフローから取得できます。
      </p>
    </header>

    <section className="docs-content-card">
      <h2>Authentication</h2>
      <p>API keyはトップページの「PRO API」から発行します。secretは発行時に一度だけ表示されます。</p>
      <pre><code>{`Authorization: Bearer vsk_your_api_key`}</code></pre>
      <p className="docs-note">API keyはパスワードと同様に扱い、ブラウザへ埋め込まずサーバー側のsecretとして保管してください。</p>
    </section>

    <section className="docs-content-card">
      <h2>Endpoints</h2>
      <div className="endpoint-list">
        {endpoints.map(([method, path, description]) => <div key={path}>
          <code>{method}</code>
          <strong>{path}</strong>
          <span>{description}</span>
        </div>)}
      </div>
    </section>

    <section className="docs-content-card">
      <h2>Example</h2>
      <pre><code>{`curl https://valostudy.alec-ofc.com/api/v1/studies \\\n  -H "Authorization: Bearer $VALOSTUDY_API_KEY"`}</code></pre>
      <p>
        一覧レスポンスは <code>object: "list"</code> と <code>data</code> を返します。
        認証済みレスポンスはprivate扱いでキャッシュされません。
      </p>
    </section>
  </main>;
}
