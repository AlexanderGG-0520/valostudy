import Link from "next/link";

export const metadata = {
  title: "メールアドレスを確認 | VALOSTUDY",
};

export default function VerifyEmailPage() {
  return <main className="study-page account-page">
    <div className="study-topbar">
      <Link className="back-link" href="/">← VALOSTUDYへ戻る</Link>
      <span className="status-badge">VERIFY EMAIL</span>
    </div>
    <header className="study-header account-header">
      <p className="eyebrow">ONE MORE STEP</p>
      <h1>確認メールを送信しました</h1>
      <p>受信したメールのリンクを開くと、メールアドレス確認が完了します。</p>
    </header>
    <section className="account-card">
      <div className="section-heading compact">
        <div>
          <p className="section-index">EMAIL VERIFICATION</p>
          <h2>受信トレイを確認してください</h2>
        </div>
        <p className="section-copy">
          メールが見つからない場合は迷惑メールフォルダも確認してください。確認リンクは1時間で失効します。
        </p>
      </div>
      <p className="field-hint">
        届かない場合はトップページへ戻って同じメールアドレスでログインすると、確認メールを再送できます。
      </p>
      <div className="account-actions">
        <Link className="account-link" href="/">ログイン画面へ戻る</Link>
      </div>
    </section>
  </main>;
}
