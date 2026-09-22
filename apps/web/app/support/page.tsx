import Link from "next/link";

export const metadata = {
  title: "サポート | VALOSTUDY",
};

export default function SupportPage() {
  return <main className="study-page legal-page">
    <div className="study-topbar">
      <Link className="back-link" href="/">← VALOSTUDYへ戻る</Link>
      <span className="status-badge">SUPPORT</span>
    </div>
    <header className="study-header">
      <p className="eyebrow">HELP</p>
      <h1>サポート</h1>
      <p>VALOSTUDYの不具合、利用方法、公開MCPに関する問い合わせ窓口です。</p>
    </header>

    <article className="legal-card">
      <section>
        <h2>不具合・機能に関する問い合わせ</h2>
        <p>
          GitHub Issuesで受け付けています。再現手順、利用している画面または機能、
          発生したエラーメッセージを、秘密情報を除いて記載してください。
        </p>
        <p>
          <a
            href="https://github.com/AlexanderGG-0520/valostudy/issues"
            target="_blank"
            rel="noreferrer"
          >
            VALOSTUDY GitHub Issues
          </a>
        </p>
      </section>

      <section>
        <h2>アカウント・個人データに関する問い合わせ</h2>
        <p>
          公開Issueには、メールアドレス、認証情報、アクセストークン、非公開Studyの内容などの
          個人情報・秘密情報を書き込まないでください。削除・訂正等の依頼は、公開Issueでは
          依頼内容の概要だけを伝え、本人確認が必要な情報を公開しないでください。
        </p>
      </section>

      <section>
        <h2>公開MCP / AI連携</h2>
        <p>
          公開StudyはVALOSTUDYのMCP endpointから読み取り専用で取得できます。
          private Studyや所有者セッションの内容は公開MCPから提供しません。
          MCPの不具合を報告する場合は、Study ID自体が公開してよいものか確認してください。
        </p>
      </section>
    </article>
  </main>;
}
