import "server-only";
import { createGateway } from "ai";
import { userGateway } from "@/lib/billing/ai-keys";
import type { Identity } from "@/lib/db";

const defaultModel = "anthropic/claude-sonnet-5.5";

const gatewayKey = () => process.env.AI_GATEWAY_API_KEY?.trim() || undefined;

export const aiEnabled = (user: Pick<Identity, "demo">) =>
  Boolean(gatewayKey()) && (!user.demo || process.env.DEMO_AI === "1");

let provider: ReturnType<typeof createGateway> | undefined;

export function gateway() {
  provider ??= createGateway({
    apiKey: gatewayKey(),
    teamIdOrSlug: process.env.AI_GATEWAY_TEAM_ID?.trim() || undefined,
  });
  return provider;
}

export const briefModel = () => gateway()(briefModelId());

const chatModelId = () => process.env.AI_GATEWAY_MODEL?.trim() || defaultModel;
const briefModelId = () =>
  process.env.AI_GATEWAY_BRIEF_MODEL?.trim() ||
  process.env.AI_GATEWAY_MODEL?.trim() ||
  defaultModel;

/** The user's own budgeted key once they have bought credits, else the app key. */
export async function modelsFor(userId: string) {
  const provider = (await userGateway(userId)) ?? gateway();
  return { chat: provider(chatModelId()), brief: provider(briefModelId()) };
}

/**
 * Tags gateway reporting by user; budgets come from the key, not this.
 * `cached` lets the gateway place a moving cache breakpoint on the latest
 * message, which pays for multi-step turns; a one-shot call with a unique
 * prompt would only pay the cache-write premium.
 */
export const gatewayOptions = (userId: string, cached = false) => ({
  gateway: { user: userId, ...(cached ? { caching: "auto" as const } : {}) },
});
