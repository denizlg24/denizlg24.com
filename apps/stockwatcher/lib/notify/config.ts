import { z } from "zod";
import type { ChannelKind } from "../models";

const https = (pattern: RegExp, message: string) =>
  z.string().trim().max(500).regex(pattern, message);

export const channelInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("email"),
    address: z.email("Enter a valid email address.").max(200),
  }),
  z.object({
    kind: z.literal("whatsapp"),
    phone: z
      .string()
      .transform((value) => value.replace(/[^\d+]/g, ""))
      .pipe(
        z
          .string()
          .regex(
            /^\+\d{8,15}$/,
            "Use the full number with country code, for example +351 912 345 678.",
          ),
      ),
    apikey: z
      .string()
      .trim()
      .regex(/^\d{4,12}$/, "The CallMeBot API key is the number in its reply."),
  }),
  z.object({
    kind: z.literal("telegram"),
    token: z
      .string()
      .trim()
      .regex(
        /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/,
        "The bot token looks like 123456789:AA… and comes from @BotFather.",
      ),
    chatId: z
      .string()
      .trim()
      .regex(/^-?\d{1,20}$/, "Send your bot a message first, then try again."),
  }),
  z.object({
    kind: z.literal("discord"),
    url: https(
      /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/,
      "Paste the webhook URL Discord shows under Copy Webhook URL.",
    ),
  }),
  z.object({
    kind: z.literal("slack"),
    url: https(
      /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/,
      "Paste the Incoming Webhook URL, starting with https://hooks.slack.com/services/.",
    ),
  }),
  z.object({
    kind: z.literal("ntfy"),
    server: z
      .url({ protocol: /^https$/ })
      .max(200)
      .default("https://ntfy.sh")
      .transform((value) => value.replace(/\/+$/, "")),
    topic: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9_-]{8,64}$/,
        "Use 8–64 letters, numbers, dashes or underscores.",
      ),
    token: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => value || undefined),
  }),
  z.object({
    kind: z.literal("push"),
    endpoint: z.url({ protocol: /^https$/ }).max(1000),
    p256dh: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{80,100}$/, "The browser sent an invalid key."),
    auth: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{16,32}$/, "The browser sent an invalid key."),
  }),
  z.object({
    kind: z.literal("webhook"),
    url: z.url({ protocol: /^https$/ }).max(500),
  }),
]);
export type ChannelInput = z.infer<typeof channelInputSchema>;
/** Stored config: webhooks also carry their signing secret. */
export type ChannelConfig =
  | Exclude<ChannelInput, { kind: "webhook" }>
  | (Extract<ChannelInput, { kind: "webhook" }> & { secret: string });

const hide = (text: string, keep: number) =>
  text.length <= keep ? text : `•••${text.slice(-keep)}`;

/** What the UI may show about a destination without revealing the secret. */
export function describeTarget(config: ChannelConfig): string {
  switch (config.kind) {
    case "email":
      return config.address;
    case "whatsapp":
      return `${config.phone.slice(0, 4)} ${hide(config.phone.slice(4), 3)}`;
    case "telegram":
      return `Chat ${config.chatId}`;
    case "discord":
      return `Webhook ${hide(config.url.split("/").at(-2) ?? "", 4)}`;
    case "slack":
      return `Webhook ${hide(config.url.split("/").at(-1) ?? "", 4)}`;
    case "ntfy":
      return `${new URL(config.server).host}/${config.topic.slice(0, 4)}${hide(config.topic.slice(4), 3)}`;
    case "push":
      return `Browser · ${new URL(config.endpoint).host}`;
    case "webhook": {
      const url = new URL(config.url);
      return url.pathname === "/"
        ? url.host
        : `${url.host}/${hide(url.pathname, 4)}`;
    }
  }
}

export const defaultLabels: Record<ChannelKind, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  ntfy: "Phone push",
  push: "This browser",
  webhook: "Webhook",
};
