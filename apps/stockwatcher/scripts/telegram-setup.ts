export {};

/**
 * Points the Stockwatcher bot's webhook at the app, once per bot or domain.
 *
 *   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… APP_URL=https://stockwatcher.denizlg24.com \
 *     bun scripts/telegram-setup.ts
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const app = process.env.APP_URL;
if (!token || !secret || !app)
  throw new Error(
    "Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL.",
  );

const response = await fetch(
  `https://api.telegram.org/bot${token}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${app.replace(/\/+$/, "")}/api/alerts/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  },
);
console.log(response.status, await response.text());
