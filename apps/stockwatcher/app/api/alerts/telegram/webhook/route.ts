import {
  handleTelegramUpdate,
  telegramWebhookAllowed,
} from "@/lib/notify/connect";

/** Telegram's bot webhook; registered by scripts/telegram-setup.ts. */
export async function POST(request: Request) {
  if (
    !telegramWebhookAllowed(
      request.headers.get("x-telegram-bot-api-secret-token"),
    )
  )
    return new Response(null, { status: 403 });
  await handleTelegramUpdate(await request.json().catch(() => null));
  return new Response(null, { status: 200 });
}
