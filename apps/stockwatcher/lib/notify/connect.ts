import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { store } from "../db";
import type { ChannelConfig } from "./config";
import { defaultLabels, describeTarget } from "./config";
import { createChannel, listChannels } from "./store";

/**
 * One-click channels: the user approves in Telegram, Discord or Slack and we
 * receive the destination, instead of copying a bot token or webhook URL.
 * Each provider is on only when its app credentials are set.
 */

export const connectKinds = ["telegram", "discord", "slack"] as const;
export type ConnectKind = (typeof connectKinds)[number];

const env = (name: string) => process.env[name]?.trim() || null;

export function connectReady(): Record<ConnectKind, boolean> {
  return {
    telegram: Boolean(
      env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_BOT_USERNAME"),
    ),
    discord: Boolean(env("DISCORD_CLIENT_ID") && env("DISCORD_CLIENT_SECRET")),
    slack: Boolean(env("SLACK_CLIENT_ID") && env("SLACK_CLIENT_SECRET")),
  };
}

const stateMinutes = 15;
const hash = (state: string) =>
  createHash("sha256").update(state).digest("hex");

async function pg() {
  const s = await store();
  if (s.kind !== "pg")
    throw new Error("Connecting a channel needs the production database.");
  return s.sql;
}

/** 32 URL-safe characters: fits Telegram's 64-character start parameter. */
async function issueState(userId: string, kind: ConnectKind) {
  const sql = await pg();
  const state = randomBytes(24).toString("base64url");
  await sql`DELETE FROM stockwatcher_connect_states WHERE expires_at < now()`;
  await sql`
    INSERT INTO stockwatcher_connect_states (state_hash, user_id, kind, expires_at)
    VALUES (${hash(state)}, ${userId}, ${kind},
      now() + ${`${stateMinutes} minutes`}::interval)`;
  return state;
}

/** The user who started this connection, once: a state cannot be replayed. */
async function consumeState(state: string, kind: ConnectKind) {
  const sql = await pg();
  const [row] = await sql<{ user_id: string }[]>`
    DELETE FROM stockwatcher_connect_states
    WHERE state_hash = ${hash(state)} AND kind = ${kind} AND expires_at > now()
    RETURNING user_id`;
  return row?.user_id ?? null;
}

const callbackUrl = (origin: string, kind: "discord" | "slack") =>
  `${origin}/api/alerts/connect/${kind}/callback`;

/** Where the browser goes to approve the connection. */
export async function connectUrl(
  userId: string,
  kind: ConnectKind,
  origin: string,
): Promise<string> {
  if (!connectReady()[kind]) throw new Error("This channel is not set up.");
  const state = await issueState(userId, kind);
  switch (kind) {
    case "telegram":
      return `https://t.me/${env("TELEGRAM_BOT_USERNAME")}?start=${state}`;
    case "discord": {
      const url = new URL("https://discord.com/oauth2/authorize");
      url.searchParams.set("client_id", env("DISCORD_CLIENT_ID") ?? "");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "webhook.incoming");
      url.searchParams.set("redirect_uri", callbackUrl(origin, "discord"));
      url.searchParams.set("state", state);
      return url.toString();
    }
    case "slack": {
      const url = new URL("https://slack.com/oauth/v2/authorize");
      url.searchParams.set("client_id", env("SLACK_CLIENT_ID") ?? "");
      url.searchParams.set("scope", "incoming-webhook");
      url.searchParams.set("redirect_uri", callbackUrl(origin, "slack"));
      url.searchParams.set("state", state);
      return url.toString();
    }
  }
}

const maxChannels = 12;

async function addChannel(
  userId: string,
  config: ChannelConfig,
  label: string,
) {
  if ((await listChannels(userId)).length >= maxChannels)
    throw new Error("Remove a channel before adding another.");
  await createChannel(userId, {
    config,
    label,
    target: describeTarget(config),
  });
}

const discordToken = z.object({
  webhook: z.object({
    url: z.string(),
    name: z.string().optional(),
  }),
});

const slackToken = z.object({
  ok: z.literal(true),
  incoming_webhook: z.object({
    url: z.string(),
    channel: z.string().optional(),
  }),
});

/** Finishes a Discord or Slack approval; returns the new channel's label. */
export async function finishOAuth(
  kind: "discord" | "slack",
  params: { code: string; state: string },
  origin: string,
): Promise<string> {
  const userId = await consumeState(params.state, kind);
  if (!userId) throw new Error("This link expired. Start again from Alerts.");
  const body = new URLSearchParams({
    client_id:
      env(kind === "discord" ? "DISCORD_CLIENT_ID" : "SLACK_CLIENT_ID") ?? "",
    client_secret:
      env(
        kind === "discord" ? "DISCORD_CLIENT_SECRET" : "SLACK_CLIENT_SECRET",
      ) ?? "",
    code: params.code,
    redirect_uri: callbackUrl(origin, kind),
    ...(kind === "discord" ? { grant_type: "authorization_code" } : {}),
  });
  const response = await fetch(
    kind === "discord"
      ? "https://discord.com/api/oauth2/token"
      : "https://slack.com/api/oauth.v2.access",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (kind === "discord") {
    const parsed = discordToken.safeParse(payload);
    if (!parsed.success)
      throw new Error("Discord did not return a webhook. Try again.");
    const label = parsed.data.webhook.name
      ? `Discord · ${parsed.data.webhook.name}`
      : defaultLabels.discord;
    await addChannel(
      userId,
      { kind: "discord", url: parsed.data.webhook.url },
      label,
    );
    return label;
  }
  const parsed = slackToken.safeParse(payload);
  if (!parsed.success)
    throw new Error("Slack did not return a webhook. Try again.");
  const label = parsed.data.incoming_webhook.channel
    ? `Slack · ${parsed.data.incoming_webhook.channel}`
    : defaultLabels.slack;
  await addChannel(
    userId,
    { kind: "slack", url: parsed.data.incoming_webhook.url },
    label,
  );
  return label;
}

const telegramUpdate = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number(), type: z.string() }),
    })
    .optional(),
});

async function telegramReply(chatId: number, text: string) {
  await fetch(
    `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => undefined);
}

/** True when the request carries the secret set with setWebhook. */
export const telegramWebhookAllowed = (header: string | null) =>
  Boolean(env("TELEGRAM_WEBHOOK_SECRET")) &&
  header === env("TELEGRAM_WEBHOOK_SECRET");

/** Binds the chat that opened the deep link to the user who created it. */
export async function handleTelegramUpdate(update: unknown) {
  const parsed = telegramUpdate.safeParse(update);
  const message = parsed.success ? parsed.data.message : undefined;
  if (!message?.text) return;
  const state = message.text.match(/^\/start\s+([A-Za-z0-9_-]{16,64})$/)?.[1];
  if (!state) {
    await telegramReply(
      message.chat.id,
      "Open Stockwatcher → Alerts → Telegram to connect this chat.",
    );
    return;
  }
  const userId = await consumeState(state, "telegram");
  if (!userId) {
    await telegramReply(
      message.chat.id,
      "That link expired. Start again from Stockwatcher → Alerts.",
    );
    return;
  }
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  try {
    await addChannel(
      userId,
      { kind: "telegram", token, chatId: String(message.chat.id) },
      defaultLabels.telegram,
    );
    await telegramReply(
      message.chat.id,
      "Connected. Stockwatcher alerts you route to Telegram will arrive here.",
    );
  } catch (error) {
    await telegramReply(
      message.chat.id,
      error instanceof Error ? error.message : "That did not work. Try again.",
    );
  }
}
