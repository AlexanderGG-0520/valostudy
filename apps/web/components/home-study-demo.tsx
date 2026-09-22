import Link from "next/link";

const DEMO_STUDY_ID = "35662f3d8b7";

const demoFrames = [
  {
    src: "https://valostudy.alec-ofc.com/35662f3d8b7/frames/001201.jpg",
    timestamp: "04:00",
    label: "Ability / information",
    detail: "アビリティ展開とミニマップを含む実フレーム",
  },
  {
    src: "https://valostudy.alec-ofc.com/35662f3d8b7/frames/004801.jpg",
    timestamp: "16:00",
    label: "Angle / positioning",
    detail: "サイト内の角度保持・クロスヘア位置を確認できるフレーム",
  },
  {
    src: "https://valostudy.alec-ofc.com/35662f3d8b7/frames/008101.jpg",
    timestamp: "27:00",
    label: "Live engagement",
    detail: "実際の交戦中を切り出したフレーム",
  },
] as const;

export function HomeStudyDemo() {
  return <section className="demo-section" aria-labelledby="demo-heading">
    <div className="section-heading compact">
      <div>
        <p className="section-index">REAL STUDY EXAMPLE</p>
        <h2 id="demo-heading">「フレーム化」で何が残るのか、実試合で見る。</h2>
      </div>
      <p className="section-copy">
        デモ用の架空画像ではありません。実際のVALORANT録画をValoStudyで処理したStudyから、
        序盤・中盤・終盤のフレームをそのまま掲載しています。
      </p>
    </div>

    <div className="demo-flow" aria-label="ValoStudy processing flow">
      <span>Gameplay video</span>
      <b aria-hidden="true">→</b>
      <span>Timeline frames</span>
      <b aria-hidden="true">→</b>
      <span>AI-readable Study</span>
    </div>

    <div className="demo-frame-grid">
      {demoFrames.map((frame) => <figure className="demo-frame-card" key={frame.src}>
        <a href={frame.src}>
          <img src={frame.src} alt={`Real ValoStudy gameplay frame at ${frame.timestamp}`} loading="lazy" />
        </a>
        <figcaption>
          <span>{frame.timestamp}</span>
          <strong>{frame.label}</strong>
          <small>{frame.detail}</small>
        </figcaption>
      </figure>)}
    </div>

    <div className="demo-summary">
      <div className="demo-facts" aria-label="Demo Study facts">
        <span><strong>9,649</strong> frames</span>
        <span><strong>32:09</strong> timeline</span>
        <span><strong>5 FPS</strong> sampling</span>
        <span><strong>VCMR</strong> canonical data</span>
      </div>
      <div className="demo-actions">
        <Link className="demo-primary-link" href="/demo">実際のStudyを見る →</Link>
        <Link className="study-link" href={`/ai/${DEMO_STUDY_ID}`}>AI向け表示を見る</Link>
      </div>
    </div>

    <div className="developer-rail">
      <div>
        <p className="section-index">BUILD ON VALOSTUDY</p>
        <strong>MCP・Bearer API・Canonical Schemaを外部ツールから利用できます。</strong>
      </div>
      <nav aria-label="Developer documentation">
        <Link href="/docs/mcp">MCP</Link>
        <Link href="/docs/api">REST API</Link>
        <Link href="/docs/canonical-schema">Canonical Schema</Link>
        <Link href="/docs">Developer Docs →</Link>
      </nav>
    </div>
  </section>;
}
