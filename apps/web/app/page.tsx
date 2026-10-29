import Link from "next/link";
import { UploadForm } from "../components/upload-form";
import { BillingPanel } from "../components/billing-panel";
import { StudyLibrary } from "../components/study-library";
import { ProApiPanel } from "../components/pro-api-panel";
import { CoachWorkspace } from "../components/coach-workspace";
import { HomeStudyDemo } from "../components/home-study-demo";

const steps = [
  {
    number: "01",
    title: "試合を録画する",
    description: "VALORANTの試合全体を録画してアップロード。プレイヤー設定や状況メモも一緒に保存できます。",
  },
  {
    number: "02",
    title: "Studyを作成する",
    description: "録画を時間順のフレームに変換。分析に使えるURLと構造化データを作成します。",
  },
  {
    number: "03",
    title: "対応するAIで振り返る",
    description: "生成したStudyを対応する外部AIに渡し、立ち回りや判断の根拠を検証します。",
  },
] as const;

export default function Home() {
  return <main className="site-shell">
    <header className="hero">
      <div className="brand-row">
        <p className="brand"><span className="brand-mark">VS</span> VALOSTUDY</p>
        <nav className="brand-actions" aria-label="メインナビゲーション">
          <a className="account-link" href="#how-it-works">使い方</a>
          <a className="account-link" href="#plans">料金</a>
          <Link className="account-link" href="/docs">開発者向け</Link>
          <Link className="account-link" href="/account">ログイン・登録</Link>
        </nav>
      </div>

      <div className="hero-grid">
        <div>
          <p className="eyebrow">VALORANT MATCH REVIEW · AI-READY STUDIES</p>
          <h1>その試合、<br />次の勝利につなげよう。</h1>
          <p className="hero-lead">
            何が起きていたのか、録画を見直すだけでは分からないこともある。
            ValoStudyはVALORANTの試合録画を、外部AIが検証しやすいStudyに変換します。
          </p>
          <div className="marketing-hero-actions">
            <Link className="marketing-primary-link" href="/account">無料で始める <span aria-hidden="true">→</span></Link>
            <Link className="marketing-secondary-link" href="/demo">実際のStudyを見る</Link>
          </div>
          <p className="marketing-hero-notice">
            AIによる分析は自動実行されません。別途、対応する外部AIを利用します。
            外部AIの利用料金はValoStudyの料金に含まれません。
          </p>
        </div>
        <aside className="hero-note">
          <p className="hero-note-label">FROM GAMEPLAY TO EVIDENCE</p>
          <strong>録画を、振り返りに使える記録へ。</strong>
          <p>
            試合全体を時間順にフレーム化し、設定や状況メモとセットで保存。
            元動画は処理完了後に削除されます。Studyの公開・非公開は自分で選べます。
          </p>
        </aside>
      </div>
    </header>

    <section className="marketing-how-section" id="how-it-works" aria-labelledby="how-heading">
      <div className="marketing-section-intro">
        <p className="section-index">HOW IT WORKS</p>
        <h2 id="how-heading">3つのステップで、試合を振り返る準備を。</h2>
        <p>AIの回答をそのまま信じるのではなく、録画から抽出した場面を根拠に判断するための仕組みです。</p>
      </div>
      <div className="marketing-steps">
        {steps.map((step) => <article className="marketing-step" key={step.number}>
          <span className="marketing-step-number">{step.number}</span>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
        </article>)}
      </div>
    </section>

    <HomeStudyDemo />

    <section className="marketing-guidance" aria-labelledby="guidance-heading">
      <div>
        <p className="section-index">USE YOUR OWN AI</p>
        <h2 id="guidance-heading">使い慣れたAIで、見直したい場面を掘り下げる。</h2>
        <p>「このラウンドで味方と合わせられなかった原因は？」「アビリティを使うタイミングは適切だった？」など、具体的な問いとStudyの証拠を組み合わせて検証できます。</p>
      </div>
      <div className="marketing-guidance-note">
        <strong>ValoStudyが提供するのは、分析のための証拠データ。</strong>
        <p>分析結果の生成や正確性は利用する外部AIに依存します。録画の音声解析・自動コーチング・勝率向上の保証はありません。</p>
        <Link className="study-link" href="/docs">対応方法と技術仕様を見る →</Link>
      </div>
    </section>

    <div id="plans" className="marketing-anchor"><BillingPanel /></div>
    <div id="start-study" className="marketing-anchor"><UploadForm /></div>
    <StudyLibrary />
    <CoachWorkspace />
    <ProApiPanel />
  </main>;
}
