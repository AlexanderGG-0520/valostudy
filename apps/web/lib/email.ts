import { log } from "@valostudy/config";

function settings() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is required for email verification");
  if (!from) throw new Error("RESEND_FROM_EMAIL is required for email verification");
  return { apiKey, from };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function assertEmailConfiguration() {
  settings();
}

export async function sendVerificationEmail(to: string, url: string) {
  const { apiKey, from } = settings();
  const safeUrl = escapeHtml(url);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "VALOSTUDY メールアドレスの確認",
      html: `<p>VALOSTUDYへの登録ありがとうございます。</p><p><a href="${safeUrl}">メールアドレスを確認する</a></p><p>このリンクは1時間で失効します。</p>`,
      text: `VALOSTUDYへの登録ありがとうございます。\n\n以下のURLを開いてメールアドレスを確認してください。\n${url}\n\nこのリンクは1時間で失効します。`,
      tags: [{ name: "category", value: "email_verification" }],
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Resend email request failed (${response.status}): ${detail}`);
  }
}

export function sendVerificationEmailDetached(to: string, url: string) {
  void sendVerificationEmail(to, url).catch((error: unknown) => {
    log("auth_verification_email_failed", {
      reason: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
