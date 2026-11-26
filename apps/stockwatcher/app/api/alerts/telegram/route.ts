import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { readBody, reason } from "@/lib/notify/channel-api";
import { telegramChat } from "@/lib/notify/send";

/** Finds the chat that last messaged the user's bot. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (user.demo)
    return json({ error: "Notifications are off in preview sessions." }, 403);
  const parsed = z
    .object({
      token: z
        .string()
        .trim()
        .regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/),
    })
    .safeParse(await readBody(request));
  if (!parsed.success)
    return json(
      {
        error:
          "The bot token looks like 123456789:AA… and comes from @BotFather.",
      },
      400,
    );
  try {
    return json(await telegramChat(parsed.data.token));
  } catch (error) {
    return json({ error: reason(error) }, 422);
  }
}
