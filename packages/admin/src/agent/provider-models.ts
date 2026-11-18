import {
  type AgentToolToggles,
  type AiProviderModels,
  type AiProvidersResponse,
  type AiSubscriptionsResponse,
  type LlmCatalogModel,
  type LlmModelsResponse,
  parseSubscriptionModel,
} from "@repo/schemas";
import { pickDefaultModel } from "@repo/utils";
import type { AdminClient } from "../client";

export const AI_PROVIDER_CHANGED = "admin:ai-provider-changed";

export function notifyAiProviderChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AI_PROVIDER_CHANGED));
  }
}

export interface AgentModelCatalog extends LlmModelsResponse {
  /** The active subscription's saved model; null on Gateway. */
  defaultModel: string | null;
}

/**
 * A subscription whose listing failed still runs on its saved model, so the
 * picker keeps that one entry rather than going empty.
 */
function subscriptionCatalog(entry: AiProviderModels): AgentModelCatalog {
  if (!entry.connected || (!entry.models.length && !entry.defaultModel))
    throw new Error(
      entry.error ?? "Reconnect the selected AI provider in Models settings.",
    );
  const models: LlmCatalogModel[] = entry.models.length
    ? entry.models
    : [
        {
          id: entry.defaultModel ?? "",
          name: parseSubscriptionModel(entry.defaultModel ?? "")?.model ?? "",
          creator: entry.provider,
          tags: ["tool-use"],
        },
      ];
  return {
    models,
    stale: entry.error !== undefined,
    fetchedAt: new Date().toISOString(),
    defaultModel: entry.defaultModel,
  };
}

/** The agent picker lists the active provider's models only. */
export async function getAgentModelCatalog(
  client: AdminClient,
): Promise<AgentModelCatalog> {
  const status = await client.get<AiSubscriptionsResponse>("ai-subscriptions");
  if (status.activeProvider === "gateway") {
    const gateway = await client.get<LlmModelsResponse>("llm/models");
    return { ...gateway, defaultModel: null };
  }
  const connection =
    status.activeProvider === "chatgpt" ? status.chatgpt : status.claude;
  if (!connection.configured)
    throw new Error("Reconnect the selected AI provider in Models settings.");
  const providers = await client.get<AiProvidersResponse>("llm/providers");
  const entry = providers.providers.find(
    (provider) => provider.provider === status.activeProvider,
  );
  if (!entry)
    throw new Error("Reconnect the selected AI provider in Models settings.");
  return subscriptionCatalog(entry);
}

export function reconcileAgentModel(
  current: string | null,
  preferred: string | null,
  models: LlmModelsResponse["models"],
  providerDefault: string | null = null,
): string | null {
  for (const id of [current, preferred, providerDefault]) {
    if (id && models.some((entry) => entry.id === id)) return id;
  }
  return pickDefaultModel(models, ["tool-use"]);
}

/**
 * Subscription runtimes carry fewer hosted tools than Gateway: ChatGPT
 * searches but cannot fetch or take a reasoning override, Claude does neither
 * and thinks longer only on models with effort levels.
 */
export function unsupportedAgentTools(
  modelId: string | null,
  models: LlmCatalogModel[] | null,
): Set<keyof AgentToolToggles> {
  const unsupported = new Set<keyof AgentToolToggles>();
  const subscription = modelId ? parseSubscriptionModel(modelId) : null;
  if (!subscription) return unsupported;
  const tags = models?.find((model) => model.id === modelId)?.tags ?? [];
  unsupported.add("webFetch");
  if (!tags.includes("web-search")) unsupported.add("webSearch");
  if (subscription.provider === "chatgpt" || !tags.includes("reasoning"))
    unsupported.add("thinkLonger");
  return unsupported;
}

export function supportedAgentTools(
  tools: AgentToolToggles,
  unsupported: Set<keyof AgentToolToggles>,
): AgentToolToggles {
  return {
    webSearch: tools.webSearch && !unsupported.has("webSearch"),
    webFetch: tools.webFetch && !unsupported.has("webFetch"),
    thinkLonger: tools.thinkLonger && !unsupported.has("thinkLonger"),
  };
}
