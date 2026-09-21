import Link from "next/link";

export const metadata = {
  title: "プライバシーポリシー | VALOSTUDY",
};

export default function PrivacyPage() {
  return <main className="study-page legal-page">
    <div className="study-topbar">
      <Link className="back-link" href="/">← VALOSTUDYへ戻る</Link>
      <span className="status-badge">PRIVACY</span>
    </div>
    <header className="study-header">
      <p className="eyebrow">LEGAL</p>
      <h1>プライバシーポリシー</h1>
      <p>最終更新日: 2026年9月22日</p>
    </header>

    <article className="legal-card">
      <section>
        <h2>1. 取得する情報</h2>
        <p>本サービスは、アカウント作成時の表示名、メールアドレス、認証情報、メール確認状態、パスキーに関する公開鍵等の認証データ、規約同意記録を取得します。</p>
        <p>Study作成時には、VALORANTの録画、ランク、DPI、ゲーム内感度、解像度、映像設定、状況メモ、生成されたフレームおよび処理状態を取り扱います。また、セキュリティや障害調査のためIPアドレス、User-Agent、アクセスログ等を取り扱う場合があります。</p>
      </section>

      <section>
        <h2>2. 利用目的</h2>
        <p>取得した情報は、本人認証、アカウント管理、Studyの生成・保存・表示、料金プランの提供、メール送信、不正利用防止、セキュリティ確保、障害対応、サービス改善のために利用します。</p>
      </section>

      <section>
        <h2>3. 外部サービス</h2>
        <p>本サービスでは、必要に応じてResendによるメール送信、Stripeによる決済、Cloudflare等によるストレージ・配信・ネットワーク機能などの外部サービスを利用します。各事業者には、それぞれの処理に必要な範囲の情報のみが送信されます。</p>
      </section>

      <section>
        <h2>4. 録画とフレーム</h2>
        <p>アップロードされた元動画は、フレーム生成処理のため一時的に保存され、正常完了または最終失敗後に削除する設計です。生成されたフレームやStudyデータは、選択した公開範囲とサービスの保持設定に従って保存されます。</p>
        <p>公開設定のStudyは、URLを知る第三者やAIクライアントから閲覧される可能性があります。非公開Studyは認証された所有者向けに提供します。</p>
      </section>

      <section>
        <h2>5. パスキー</h2>
        <p>パスキー認証では、端末に保持される秘密鍵自体を本サービスが保存することはありません。本サービス側にはWebAuthn認証に必要な公開鍵、Credential識別子、カウンタ、端末種別等が保存されます。</p>
      </section>

      <section>
        <h2>6. 第三者提供</h2>
        <p>法令に基づく場合、本人の同意がある場合、または本サービスの提供に必要な業務委託先へ必要最小限の情報を取り扱わせる場合を除き、個人情報を第三者へ不当に提供しません。</p>
      </section>

      <section>
        <h2>7. 安全管理</h2>
        <p>認証情報の保護、アクセス制御、秘密情報の分離、通信の保護等、合理的な安全管理措置を講じます。ただし、インターネット上のサービスについて絶対的な安全性を保証するものではありません。</p>
      </section>

      <section>
        <h2>8. 保存期間と削除</h2>
        <p>情報は、サービス提供、法令対応、不正利用対策その他必要な期間に限って保存します。保存する必要がなくなった情報は、合理的な方法で削除または匿名化します。</p>
      </section>

      <section>
        <h2>9. ポリシーの変更</h2>
        <p>サービス内容や法令等の変更に応じて本ポリシーを改定することがあります。重要な変更については、本サービス上で分かりやすい方法により通知します。</p>
      </section>
    </article>
  </main>;
}
