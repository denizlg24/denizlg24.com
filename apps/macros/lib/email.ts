import { Resend } from "resend";

const productionOrigin = "https://macros.denizlg24.com";

export function getPublicAppOrigin(): string {
  const configured = process.env.MACROS_BETTER_AUTH_URL?.trim();
  const fallback =
    process.env.NODE_ENV === "production"
      ? productionOrigin
      : "http://localhost:3000";

  return new URL(configured || fallback).origin;
}

export function getPublicAppUrl(pathOrUrl: string): string {
  const input = new URL(pathOrUrl, getPublicAppOrigin());
  return new URL(
    `${input.pathname}${input.search}${input.hash}`,
    getPublicAppOrigin(),
  ).toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

interface AuthEmailInput {
  actionLabel: string;
  actionUrl: string;
  body: string;
  preheader: string;
  title: string;
}

export function createAuthEmail({
  actionLabel,
  actionUrl,
  body,
  preheader,
  title,
}: AuthEmailInput): { html: string; text: string } {
  const safeActionLabel = escapeHtml(actionLabel);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeBody = escapeHtml(body);
  const safePreheader = escapeHtml(preheader);
  const safeTitle = escapeHtml(title);

  return {
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;background:#f3f3f3;color:#171717;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:36px;height:36px;border-radius:50%;background:#171717;color:#ffffff;text-align:center;font-size:17px;font-weight:800;">M</td>
                    <td style="padding-left:12px;font-size:16px;font-weight:700;letter-spacing:-0.2px;">Macros</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 32px;">
                <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;letter-spacing:-0.7px;">${safeTitle}</h1>
                <p style="margin:0 0 26px;color:#626262;font-size:16px;line-height:1.6;">${safeBody}</p>
                <a href="${safeActionUrl}" style="display:inline-block;border-radius:999px;background:#171717;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 22px;">${safeActionLabel}</a>
                <p style="margin:28px 0 0;color:#8a8a8a;font-size:12px;line-height:1.6;">If the button does not work, copy this link into your browser:<br><a href="${safeActionUrl}" style="color:#626262;word-break:break-all;">${safeActionUrl}</a></p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;color:#8a8a8a;font-size:12px;">Your nutrition, clearly tracked.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Macros\n\n${title}\n\n${body}\n\n${actionLabel}: ${actionUrl}\n\nIf you did not request this email, you can ignore it.`,
  };
}

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is required to send auth emails.");
  }

  if (!from) {
    throw new Error("EMAIL_FROM is required to send auth emails.");
  }

  const resend = new Resend(resendApiKey);

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
