import "server-only";
import { randomBytes } from "node:crypto";
import { channelInputSchema, describeTarget, defaultLabels } from "./config";
import type { ChannelConfig } from "./config";
import { deliver, type Message } from "./send";

export const appUrl = (hash = "") =>
  `${(process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "")}/${hash}`;

export const testMessage = (label: string): Message => ({
  title: "Stockwatcher test alert",
  body: `${label} is connected. Price alerts you route here will arrive just like this.`,
  url: appUrl("#alerts"),
  tone: "info",
  data: { Example: "AAPL price ≥ 250.00", Channel: label },
});

export const reason = (error: unknown) =>
  (error instanceof Error ? error.message : "Delivery failed.").slice(0, 200);

export async function readBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

export function parseChannel(input: unknown) {
  const parsed = channelInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    } as const;
  const config: ChannelConfig =
    parsed.data.kind === "webhook"
      ? { ...parsed.data, secret: randomBytes(24).toString("base64url") }
      : parsed.data;
  const raw =
    input && typeof input === "object" && "label" in input
      ? String(input.label).trim().slice(0, 60)
      : "";
  return {
    config,
    label: raw || defaultLabels[config.kind],
    target: describeTarget(config),
  } as const;
}

const sends = new Map<string, number[]>();

/** Caps test messages so the endpoints can't be used to spam a destination. */
export function allowTest(userId: string) {
  const now = Date.now();
  const recent = (sends.get(userId) ?? []).filter(
    (time) => now - time < 10 * 60_000,
  );
  if (recent.length >= 8) return false;
  recent.push(now);
  sends.set(userId, recent);
  return true;
}

export async function tryDeliver(config: ChannelConfig, label: string) {
  try {
    await deliver(config, testMessage(label));
    return null;
  } catch (error) {
    return reason(error);
  }
}
