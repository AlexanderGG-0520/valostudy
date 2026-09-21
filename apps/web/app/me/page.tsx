import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { MyPageClient } from "../../components/my-page-client";

export default async function MyPage() {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect("/");

  return <main className="study-page">
    <div className="study-topbar">
      <a className="back-link" href="/">← ValoStudy</a>
      <span className="status-badge">MY PAGE</span>
    </div>
    <header className="study-header">
      <p className="eyebrow">ACCOUNT & SECURITY</p>
      <h1>マイページ</h1>
      <p>アカウント、プラン、パスキーなどのセキュリティ設定を管理します。</p>
    </header>
    <MyPageClient />
  </main>;
}
