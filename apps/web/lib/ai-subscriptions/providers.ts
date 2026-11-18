import {
  type AiProviderModels,
  type AiProvidersResponse,
  aiProvidersResponseSchema,
  type LlmCatalogModel,
  subscriptionModelId,
} from "@repo/schemas";
import { getAiConnections } from "@/lib/ai-connections/gateway";
import { LlmConfigurationError } from "@/lib/llm-errors";
import { listModels } from "@/lib/llm-model-catalog";
import {
  chatgptModelsCached,
  claudeModels,
  subscriptionStatus,
} from "./service";

/** Groups subscription models apart from Gateway creators in the rich picker. */
export const SUBSCRIPTION_CREATORS = {
  "claude-code": "Claude plan",
  chatgpt: "ChatGPT plan",
} as const;

function failure(error: unknown, fallback: string) {
  return error instanceof LlmConfigurationError ? error.message : fallback;
}

async function gatewayModels(): Promise<AiProviderModels> {
  const [connection, catalog] = await Promise.allSettled([
    getAiConnections(),
    listModels(),
  ]);
  const connected =
    connection.status === "fulfilled" && connection.value.gateway.configured;
  if (catalog.status === "rejected")
    return {
      provider: "gateway",
      connected,
      defaultModel: null,
      models: [],
      stale: false,
      error: "Gateway catalog unavailable",
    };
  return {
    provider: "gateway",
    connected,
    defaultModel: null,
    stale: catalog.value.stale,
    models: catalog.value.models.map(
      (model): LlmCatalogModel => ({
        id: model.id,
        name: model.name,
        creator: model.creator,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        tags: model.tags,
        ...(model.pricing
          ? {
              pricing: {
                input: model.pricing.input,
                output: model.pricing.output,
              },
            }
          : {}),
      }),
    ),
  };
}

export async function listProviderModels(): Promise<AiProvidersResponse> {
  const status = await subscriptionStatus();

  const claude = async (): Promise<AiProviderModels> => {
    const base = {
      provider: "claude-code" as const,
      connected: status.claude.configured,
      defaultModel: status.claude.model
        ? subscriptionModelId("claude-code", status.claude.model)
        : null,
      stale: false,
    };
    if (!status.claude.configured) return { ...base, models: [] };
    try {
      const models = await claudeModels();
      return {
        ...base,
        models: models.map((model) => ({
          id: subscriptionModelId("claude-code", model.id),
          name: model.name,
          creator: SUBSCRIPTION_CREATORS["claude-code"],
          tags: ["tool-use", ...(model.supportsEffort ? ["reasoning"] : [])],
        })),
      };
    } catch (error) {
      return {
        ...base,
        models: [],
        error: failure(error, "Could not list Claude models"),
      };
    }
  };

  const chatgpt = async (): Promise<AiProviderModels> => {
    const base = {
      provider: "chatgpt" as const,
      connected: status.chatgpt.configured,
      defaultModel: status.chatgpt.model
        ? subscriptionModelId("chatgpt", status.chatgpt.model)
        : null,
      stale: false,
    };
    if (!status.chatgpt.configured) return { ...base, models: [] };
    try {
      const models = await chatgptModelsCached();
      return {
        ...base,
        models: models.map((model) => ({
          id: subscriptionModelId("chatgpt", model.slug),
          name: model.display_name,
          creator: SUBSCRIPTION_CREATORS.chatgpt,
          tags: ["tool-use", "web-search"],
        })),
        ...(status.chatgpt.lastError
          ? { error: status.chatgpt.lastError }
          : {}),
      };
    } catch (error) {
      return {
        ...base,
        models: [],
        error: failure(error, "Could not list ChatGPT models"),
      };
    }
  };

  const providers = await Promise.all([gatewayModels(), claude(), chatgpt()]);
  return aiProvidersResponseSchema.parse({
    activeProvider: status.activeProvider,
    providers,
  });
}
