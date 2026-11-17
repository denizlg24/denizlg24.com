import { anthropic } from "@ai-sdk/anthropic";
import { createGateway, type LanguageModel, type ToolSet } from "ai";
import { getGatewayCredential } from "@/lib/ai-connections/gateway";

// The AI SDK side of the Vercel AI Gateway: the agent loop's language models
// and the provider-executed tools it may attach. Model ids are fully
// qualified Gateway ids; nothing here reaches a provider directly.

/** Credentials resolve before every request, including rotating OAuth access tokens. */
export async function gatewayProvider(): Promise<
  ReturnType<typeof createGateway>
> {
  const credential = await getGatewayCredential();
  return createGateway({
    apiKey: async () => (await getGatewayCredential()).apiKey,
    ...(credential.teamIdOrSlug
      ? { teamIdOrSlug: credential.teamIdOrSlug }
      : {}),
  });
}

export async function gatewayLanguageModel(
  modelId: string,
): Promise<LanguageModel> {
  return (await gatewayProvider())(modelId);
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
export async function providerTools(
  modelId: string,
  request: ProviderToolRequest,
): Promise<ToolSet> {
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
    tools.web_search = (await gatewayProvider()).tools.perplexitySearch();
  }
  return tools;
}
