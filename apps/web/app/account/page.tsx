import Link from "next/link";
import { AccountPanel } from "../../components/account-panel";

export const metadata = {
  title: "マイページ | VALOSTUDY",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <main className="study-page account-page">
    <div className="study-topbar">
      <Link className="back-link" href="/">← VALOSTUDYへ戻る</Link>
      <span className="status-badge">MY PAGE</span>
    </div>
    <header className="study-header account-header">
      <p className="eyebrow">ACCOUNT & SECURITY</p>
      <h1>マイページ</h1>
      <p>アカウント情報とログイン用パスキーを管理します。</p>
    </header>
    <AccountPanel />
  </main>;
}
