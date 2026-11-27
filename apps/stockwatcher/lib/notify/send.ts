import "server-only";
import { createHmac } from "node:crypto";
import webpush from "web-push";
import { appUrl } from "./compose";
import type { ChannelConfig } from "./config";
import { publicPost } from "./public-post";
import {
  discordPayload,
  emailHtml,
  emailText,
  pushPayload,
  shortText,
  slackPayload,
  telegramHtml,
  webhookPayload,
  whatsappText,
} from "./render";
import type { Message } from "./types";

export type { Message } from "./types";

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

export async function deliver(config: ChannelConfig, message: Message) {
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
          text: emailText(message),
          html: emailHtml(message, appUrl("apple-icon.png")),
        }),
      });
      if (!response.ok) throw await failure(response, "Resend");
      return;
    }
    case "whatsapp": {
      const query = new URLSearchParams({
        phone: config.phone,
        text: whatsappText(message),
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
            text: telegramHtml(message),
            parse_mode: "HTML",
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
        body: JSON.stringify(discordPayload(message)),
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
        body: JSON.stringify(slackPayload(message)),
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
          message: shortText(message),
          click: message.url,
          actions: [
            {
              action: "view",
              label: message.action,
              url: message.url,
              clear: true,
            },
          ],
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
          JSON.stringify(pushPayload(message)),
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
      const body = JSON.stringify(
        webhookPayload(message, new Date().toISOString()),
      );
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
