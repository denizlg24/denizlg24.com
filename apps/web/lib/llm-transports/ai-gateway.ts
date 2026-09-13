import { anthropic } from "@ai-sdk/anthropic";
import { createGateway, type LanguageModel, type ToolSet } from "ai";
import { LlmConfigurationError } from "@/lib/llm-errors";

// The AI SDK side of the Vercel AI Gateway: the agent loop's language models
// and the provider-executed tools it may attach. Model ids are fully
// qualified Gateway ids; nothing here reaches a provider directly.

let provider: ReturnType<typeof createGateway> | null = null;
let providerKey: string | null = null;

/**
 * Built on first use so the key is checked at the start of a generation,
 * never at import — `next build` and tests load this module without it.
 */
function gatewayProvider(): ReturnType<typeof createGateway> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new LlmConfigurationError(
      "AI_GATEWAY_API_KEY is not configured; LLM generation is unavailable",
    );
  }
  if (!provider || providerKey !== apiKey) {
    provider = createGateway({ apiKey });
    providerKey = apiKey;
  }
  return provider;
}

export function gatewayLanguageModel(modelId: string): LanguageModel {
  return gatewayProvider()(modelId);
}

export interface ProviderToolRequest {
  webSearch: boolean;
  webFetch: boolean;
}

export function isAnthropicModel(modelId: string): boolean {
  return modelId.startsWith("anthropic/");
}

/**
 * Anthropic models get Anthropic's own search and fetch, which cite their
 * sources. Anything else searches through the Gateway's Perplexity tool;
 * there is no provider-neutral fetch, so it simply is not offered.
 */
export function providerTools(
  modelId: string,
  request: ProviderToolRequest,
): ToolSet {
  const tools: ToolSet = {};
  if (isAnthropicModel(modelId)) {
    if (request.webSearch) {
      tools.web_search = anthropic.tools.webSearch_20250305({ maxUses: 5 });
    }
    if (request.webFetch) {
      tools.web_fetch = anthropic.tools.webFetch_20250910({ maxUses: 5 });
    }
    return tools;
  }
  if (request.webSearch) {
    tools.web_search = gatewayProvider().tools.perplexitySearch();
  }
  return tools;
}
