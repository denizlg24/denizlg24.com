import type { AiSubscriptionsResponse, LlmModelsResponse } from "@repo/schemas";
import { pickDefaultModel } from "@repo/utils";
import type { AdminClient } from "../client";

export const AI_PROVIDER_CHANGED = "admin:ai-provider-changed";

export function notifyAiProviderChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AI_PROVIDER_CHANGED));
  }
}

/** The subscription runtime uses its saved model; Gateway accepts per-turn models. */
export async function getAgentModelCatalog(
  client: AdminClient,
): Promise<LlmModelsResponse> {
  const status = await client.get<AiSubscriptionsResponse>("ai-subscriptions");
  if (status.activeProvider === "gateway") {
    return client.get<LlmModelsResponse>("llm/models");
  }
  const connection =
    status.activeProvider === "chatgpt" ? status.chatgpt : status.claude;
  if (!connection.configured || !connection.model) {
    throw new Error("Reconnect the selected AI provider in Models settings.");
  }
  const label = status.activeProvider === "chatgpt" ? "ChatGPT" : "Claude";
  return {
    models: [
      {
        id: `${status.activeProvider}/${connection.model}`,
        name: `${label} · ${connection.model}`,
        creator: status.activeProvider === "chatgpt" ? "openai" : "anthropic",
        tags: ["tool-use"],
      },
    ],
    stale: false,
    fetchedAt: new Date().toISOString(),
  };
}

export function reconcileAgentModel(
  current: string | null,
  preferred: string | null,
  models: LlmModelsResponse["models"],
): string | null {
  for (const id of [current, preferred]) {
    if (id && models.some((entry) => entry.id === id)) return id;
  }
  return pickDefaultModel(models, ["tool-use"]);
}
