import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ValoStudy",
  description: "録画を、次の判断の材料へ。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
