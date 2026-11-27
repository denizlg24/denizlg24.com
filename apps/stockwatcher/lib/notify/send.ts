import "server-only";
import { createHmac } from "node:crypto";
import webpush from "web-push";
import type { ChannelConfig } from "./config";
import { publicPost } from "./public-post";

export type Message = {
  title: string;
  body: string;
  /** Deep link into Stockwatcher. */
  url: string;
  tone: "up" | "down" | "info";
  data?: Record<string, string | number | null>;
};

export const emailReady = () => Boolean(process.env.RESEND_API_KEY);

/** VAPID keys from `bunx web-push generate-vapid-keys`; the subject is a contact URL. */
export function vapidKeys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject:
      process.env.VAPID_SUBJECT?.trim() || "mailto:geral@oceaninformatix.com",
  };
}
const emailFrom = () =>
  process.env.ALERT_EMAIL_FROM || "Stockwatcher <alerts@auth.denizlg24.com>";

const timeout = () => AbortSignal.timeout(10_000);

async function failure(response: Response, service: string) {
  let detail = "";
  try {
    detail = (await response.text()).replace(/\s+/g, " ").slice(0, 140);
  } catch {}
  return new Error(
    `${service} answered ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

function emailHtml(message: Message) {
  const accent =
    message.tone === "up"
      ? "#16794c"
      : message.tone === "down"
        ? "#b3261e"
        : "#1f4e8c";
  const rows = Object.entries(message.data ?? {})
    .filter(([, value]) => value !== null && value !== "")
    .map(
      ([key, value]) =>
        `<tr><td style="padding:6px 0;color:#6b6b6b">${escape(key)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escape(String(value))}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e2e0d8;border-radius:6px">
<tr><td style="height:4px;background:${accent};border-radius:6px 6px 0 0"></td></tr>
<tr><td style="padding:20px 24px 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b">Stockwatcher alert</td></tr>
<tr><td style="padding:0 24px 8px;font-size:22px;font-weight:650">${escape(message.title)}</td></tr>
<tr><td style="padding:0 24px 12px;font-size:15px;line-height:1.5;white-space:pre-line">${escape(message.body)}</td></tr>
${rows ? `<tr><td style="padding:0 24px 8px"><table role="presentation" width="100%" style="font-size:14px;border-top:1px solid #eceae3">${rows}</table></td></tr>` : ""}
<tr><td style="padding:12px 24px 24px"><a href="${escape(message.url)}" style="display:inline-block;padding:10px 16px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;font-size:14px">Open in Stockwatcher</a></td></tr>
</table>
<p style="font-size:12px;color:#8a8a8a">You set this alert in Stockwatcher. Manage notifications under Alerts.</p>
</td></tr></table></body></html>`;
}

export async function deliver(config: ChannelConfig, message: Message) {
  const text = `${message.title}\n${message.body}\n${message.url}`;
  switch (config.kind) {
    case "email": {
      const key = process.env.RESEND_API_KEY;
      if (!key) throw new Error("Email delivery is not configured.");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: timeout(),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom(),
          to: [config.address],
          subject: message.title,
          text,
          html: emailHtml(message),
        }),
      });
      if (!response.ok) throw await failure(response, "Resend");
      return;
    }
    case "whatsapp": {
      const query = new URLSearchParams({
        phone: config.phone,
        text: `*${message.title}*\n${message.body}\n${message.url}`,
        apikey: config.apikey,
      });
      const response = await fetch(
        `https://api.callmebot.com/whatsapp.php?${query}`,
        { signal: timeout() },
      );
      const body = await response.text();
      if (!response.ok || /APIKey is invalid|ERROR|not active/i.test(body))
        throw new Error(
          /APIKey/i.test(body)
            ? "CallMeBot rejected the API key. Check the number and key."
            : `CallMeBot answered ${response.status}.`,
        );
      return;
    }
    case "telegram": {
      const response = await fetch(
        `https://api.telegram.org/bot${config.token}/sendMessage`,
        {
          method: "POST",
          signal: timeout(),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text,
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
      } | null;
      if (!result?.ok)
        throw new Error(
          `Telegram: ${result?.description ?? `status ${response.status}`}`,
        );
      return;
    }
    case "discord": {
      const response = await fetch(config.url, {
        method: "POST",
        signal: timeout(),
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Stockwatcher",
          embeds: [
            {
              title: message.title,
              description: message.body,
              url: message.url,
              color:
                message.tone === "up"
                  ? 0x16794c
                  : message.tone === "down"
                    ? 0xb3261e
                    : 0x1f4e8c,
              fields: Object.entries(message.data ?? {})
                .filter(([, value]) => value !== null && value !== "")
                .slice(0, 8)
                .map(([name, value]) => ({
                  name,
                  value: String(value),
                  inline: true,
                })),
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      });
      if (!response.ok) throw await failure(response, "Discord");
      return;
    }
    case "slack": {
      const response = await fetch(config.url, {
        method: "POST",
        signal: timeout(),
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*${message.title}*\n${message.body}\n<${message.url}|Open in Stockwatcher>`,
        }),
      });
      if (!response.ok) throw await failure(response, "Slack");
      return;
    }
    case "ntfy": {
      const status = await publicPost(
        config.server,
        {
          "Content-Type": "application/json",
          ...(config.token
            ? { Authorization: `Bearer ${config.token}` }
            : undefined),
        },
        JSON.stringify({
          topic: config.topic,
          title: message.title,
          message: message.body,
          click: message.url,
          priority: message.tone === "info" ? 3 : 4,
          tags: [
            message.tone === "up"
              ? "chart_with_upwards_trend"
              : message.tone === "down"
                ? "chart_with_downwards_trend"
                : "bell",
          ],
        }),
      );
      if (status < 200 || status >= 300)
        throw new Error(`ntfy answered ${status}.`);
      return;
    }
    case "push": {
      const vapid = vapidKeys();
      if (!vapid) throw new Error("Browser push is not configured.");
      try {
        await webpush.sendNotification(
          {
            endpoint: config.endpoint,
            keys: { p256dh: config.p256dh, auth: config.auth },
          },
          JSON.stringify({
            title: message.title,
            body: message.body,
            url: message.url,
            tone: message.tone,
          }),
          {
            vapidDetails: vapid,
            TTL: 3600,
            urgency: message.tone === "info" ? "normal" : "high",
            timeout: 10_000,
          },
        );
      } catch (error) {
        if (error instanceof webpush.WebPushError)
          throw new Error(
            error.statusCode === 404 || error.statusCode === 410
              ? "This browser unsubscribed. Turn browser push on again."
              : `The push service answered ${error.statusCode}.`,
          );
        throw error;
      }
      return;
    }
    case "webhook": {
      const body = JSON.stringify({
        event: "stockwatcher.alert",
        sentAt: new Date().toISOString(),
        ...message,
      });
      const signature = createHmac("sha256", config.secret)
        .update(body)
        .digest("hex");
      const status = await publicPost(
        config.url,
        {
          "Content-Type": "application/json",
          "User-Agent": "Stockwatcher-Alerts/1",
          "X-Stockwatcher-Signature": `sha256=${signature}`,
        },
        body,
      );
      if (status < 200 || status >= 300)
        throw new Error(`The webhook answered ${status}.`);
      return;
    }
  }
}

/** The chat that most recently messaged the bot, so users don't hunt for chat IDs. */
export async function telegramChat(token: string) {
  const base = `https://api.telegram.org/bot${token}`;
  const me = (await fetch(`${base}/getMe`, { signal: timeout() })
    .then((response) => response.json())
    .catch(() => null)) as {
    ok?: boolean;
    result?: { username?: string };
  } | null;
  if (!me?.ok)
    throw new Error("Telegram didn’t accept that token. Copy it again.");
  const updates = (await fetch(`${base}/getUpdates?limit=50`, {
    signal: timeout(),
  })
    .then((response) => response.json())
    .catch(() => null)) as {
    ok?: boolean;
    result?: {
      message?: {
        chat: {
          id: number;
          type: string;
          first_name?: string;
          title?: string;
          username?: string;
        };
      };
    }[];
  } | null;
  const chat = updates?.result
    ?.map((update) => update.message?.chat)
    .filter((entry) => entry !== undefined)
    .at(-1);
  return {
    bot: me.result?.username ?? null,
    chat: chat
      ? {
          id: String(chat.id),
          name: chat.title ?? chat.first_name ?? chat.username ?? "Chat",
        }
      : null,
  };
}
