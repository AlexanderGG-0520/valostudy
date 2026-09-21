export default function PrivacyPage() {
  return <main className="study-page legal-page">
    <div className="study-topbar">
      <a className="back-link" href="/">← ValoStudy</a>
      <span className="status-badge">PRIVACY</span>
    </div>
    <header className="study-header">
      <p className="eyebrow">VALOSTUDY LEGAL</p>
      <h1>プライバシーポリシー</h1>
      <p>ValoStudyにおける情報の取扱い方針です。最終更新: 2026年9月22日</p>
    </header>
    <article className="study-card legal-copy">
      <h2>1. 取得する情報</h2>
      <p>アカウント情報（表示名、メールアドレス、認証状態）、Studyに入力したプレイヤー設定やメモ、アップロードした録画、生成フレーム、利用状況、課金状態、セッション情報、APIキー管理情報などを取り扱います。</p>
      <h2>2. 利用目的</h2>
      <p>本人認証、Study処理、サービス提供、利用上限管理、課金、セキュリティ、不正利用防止、障害解析およびサービス改善のために利用します。</p>
      <h2>3. 録画データ</h2>
      <p>アップロードされた元動画はフレーム生成処理のため一時的に保存し、処理完了後に削除します。生成フレームは各プランの保持期間とStudyの公開範囲に従って保存されます。</p>
      <h2>4. 外部サービス</h2>
      <p>メール送信にResend、決済にStripe、オブジェクトストレージ等のインフラ事業者を利用する場合があります。各サービスには必要最小限の情報のみを送信します。</p>
      <h2>5. 公開Study</h2>
      <p>Studyを公開設定にした場合、そのStudyのURLを知る第三者やAIツールが、フレーム、設定、状況メモなどを閲覧できる場合があります。非公開Studyは認証された所有者に限定します。</p>
      <h2>6. セキュリティ</h2>
      <p>メール認証、パスキー、セッション管理等を用いて不正アクセスの低減に努めます。ただし、インターネット上の通信・保存について完全な安全性を保証するものではありません。</p>
      <h2>7. 変更</h2>
      <p>機能追加や法令上の要請に応じて本ポリシーを変更する場合があります。重要な変更はサービス上で案内します。</p>
    </article>
  </main>;
}
