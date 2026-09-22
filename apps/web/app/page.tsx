import Link from "next/link";
import { UploadForm } from "../components/upload-form";
import { BillingPanel } from "../components/billing-panel";
import { StudyLibrary } from "../components/study-library";
import { ProApiPanel } from "../components/pro-api-panel";
import { CoachWorkspace } from "../components/coach-workspace";\nimport { HomeStudyDemo } from "../components/home-study-demo";

export default function Home() {
  return <main className="site-shell">
    <header className="hero">
      <div className="brand-row">
        <p className="brand"><span className="brand-mark">VS</span> VALOSTUDY</p>
        <div className="brand-actions">
          <span className="brand-meta">PLAY · STUDY · REPEAT</span>
          <Link className="account-link" href="/account">マイページ</Link>
        </div>
      </div>

      <div className="hero-grid">
        <div>
          <p className="eyebrow">VALORANT GAMEPLAY EVIDENCE</p>
          <h1>試合を、<br />判断できる材料へ。</h1>
          <p className="hero-lead">
            試合全体の録画とプレイヤー設定をひとつのStudyに。
            全体をフレーム化し、AIがURLから直接検証できる証拠へ変換します。
          </p>
        </div>
        <aside className="hero-note">
          <p className="hero-note-label">FULL MATCH PIPELINE</p>
          <strong>Upload → Sample → Study</strong>
          <p>
            元動画は処理のためだけに一時保持。フレーム保存が完了したら削除し、
            コーチングに必要な情報だけを残します。
          </p>
        </aside>
      </div>
    </header>

    <HomeStudyDemo />\n    <BillingPanel />
    <UploadForm />
    <StudyLibrary />
    <CoachWorkspace />
    <ProApiPanel />
  </main>;
}
