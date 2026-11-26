import { currentUser, json, sameOrigin } from "@/lib/auth";
import {
  allowTest,
  parseChannel,
  readBody,
  tryDeliver,
} from "@/lib/notify/channel-api";
import { emailReady } from "@/lib/notify/send";
import { createChannel, listChannels, publicChannel } from "@/lib/notify/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  const channels = user.demo ? [] : await listChannels(user.id);
  return json({
    channels: channels.map(publicChannel),
    email: { ready: emailReady(), address: user.email },
    demo: user.demo,
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (user.demo)
    return json({ error: "Notifications are off in preview sessions." }, 403);
  const parsed = parseChannel(await readBody(request));
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  if (
    parsed.config.kind === "email" &&
    parsed.config.address.toLowerCase() !== user.email?.toLowerCase()
  )
    return json(
      {
        error: user.email
          ? `Email alerts can only go to your account address, ${user.email}.`
          : "Your account has no email address to send alerts to.",
      },
      400,
    );
  if ((await listChannels(user.id)).length >= 12)
    return json({ error: "Remove a channel before adding another." }, 400);
  if (!allowTest(user.id))
    return json(
      { error: "Too many test messages. Wait a few minutes and try again." },
      429,
    );
  const failed = await tryDeliver(parsed.config, parsed.label);
  if (failed)
    return json(
      { error: `The test message didn’t go through. ${failed}` },
      422,
    );
  const id = await createChannel(user.id, parsed);
  const channel = (await listChannels(user.id)).find((item) => item.id === id);
  return json({
    channel: channel ? publicChannel(channel) : null,
    secret: parsed.config.kind === "webhook" ? parsed.config.secret : undefined,
  });
}
