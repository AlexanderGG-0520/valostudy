import type { Metadata } from "next";
import "./globals.css";

const description =
  "VALORANTの試合録画を、対応する外部AIが検証できるStudyに変換。時間順のフレームとプレイヤー設定を整理し、自分のプレイを振り返る材料にできます。無料プランあり。";

export const metadata: Metadata = {
  metadataBase: new URL("https://valostudy.alec-ofc.com"),
  title: "ValoStudy | VALORANTの試合録画をAIで振り返るためのStudyに",
  description,
  twitter: {
    card: "summary",
    title: "ValoStudy | VALORANTの試合を振り返る",
    description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
