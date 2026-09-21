import { config } from "@valostudy/config";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

export async function sendVerificationEmail(to: string, url: string) {
  if (process.env.NODE_ENV === "test") return;
  const c = config();
  if (!c.RESEND_API_KEY || !c.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL are required to send verification email");
  }

  const safeUrl = escapeHtml(url);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: c.RESEND_FROM_EMAIL,
      to: [to],
      subject: "ValoStudy メールアドレスの確認",
      text: `ValoStudyのメールアドレスを確認してください。\n\n${url}\n\nこのリンクの有効期限は1時間です。`,
      html: `<div style="font-family:system-ui,sans-serif;line-height:1.7;color:#20241f">
        <h1 style="font-size:20px">ValoStudy メールアドレスの確認</h1>
        <p>アカウント作成を完了するには、下のリンクからメールアドレスを確認してください。</p>
        <p><a href="${safeUrl}">メールアドレスを確認する</a></p>
        <p style="font-size:13px;color:#6f6a60">このリンクの有効期限は1時間です。</p>
      </div>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend verification email failed (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }
}
