import Link from "next/link";

export default function CanonicalSchemaDocsPage() {
  return <main className="study-page docs-page">
    <div className="study-topbar">
      <Link className="back-link" href="/docs">← Developer Docs</Link>
      <span className="status-badge">VCMR</span>
    </div>
    <header className="study-header docs-header">
      <p className="section-index">CANONICAL REPRESENTATION</p>
      <h1>録画を、安定した共通表現へ。</h1>
      <p>
        VCMRはValoStudyが生成するcanonical representationです。動画ファイルそのものではなく、
        timeline・player settings・coaching protocol・frame evidenceをAIや外部ツールが扱える形で表現します。
      </p>
    </header>

    <section className="docs-content-card">
      <h2>Canonical resource</h2>
      <pre><code>{`GET /{studyId}/canonical.json`}</code></pre>
      <p>
        各Study自身が <code>canonical_schema_version</code> を公開するため、
        consumerは特定バージョンを暗黙に仮定せずversionを見て処理できます。
      </p>
    </section>

    <section className="docs-content-card">
      <h2>Timeline model</h2>
      <div className="canonical-facts">
        <div><span>origin</span><strong>video_start</strong></div>
        <div><span>unit</span><strong>ms</strong></div>
        <div><span>frame identity</span><strong>sample_index + timestamp_ms</strong></div>
      </div>
      <p>
        sampling timestampは元動画の厳密なPTSではなく、固定レートsampleのcanonical timelineです。
        これによりAI・API・MCPが同じ時系列参照を共有できます。
      </p>
    </section>

    <section className="docs-content-card">
      <h2>Related resources</h2>
      <div className="endpoint-list">
        <div><code>JSON</code><strong>{`/{studyId}/canonical.json`}</strong><span>VCMR canonical representation</span></div>
        <div><code>JSON</code><strong>{`/{studyId}/manifest.json`}</strong><span>compact legacy projection</span></div>
        <div><code>JSON</code><strong>{`/{studyId}/frames.json?offset=0&limit=240`}</strong><span>paginated frame index</span></div>
        <div><code>JPEG</code><strong>{`/{studyId}/frames/000001.jpg`}</strong><span>frame evidence</span></div>
      </div>
    </section>
  </main>;
}
