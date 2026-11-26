import "server-only";
import { createGateway } from "ai";
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

export const chatModel = () =>
  gateway()(process.env.AI_GATEWAY_MODEL?.trim() || defaultModel);

export const briefModel = () =>
  gateway()(
    process.env.AI_GATEWAY_BRIEF_MODEL?.trim() ||
      process.env.AI_GATEWAY_MODEL?.trim() ||
      defaultModel,
  );
