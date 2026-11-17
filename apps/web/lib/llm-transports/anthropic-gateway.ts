import Anthropic from "@anthropic-ai/sdk";
import { getGatewayCredential } from "@/lib/ai-connections/gateway";

// The only place an Anthropic SDK client is constructed. It talks to the
// Vercel AI Gateway's Anthropic-compatible Messages endpoint, so model ids
// are fully qualified Gateway ids (e.g. "anthropic/claude-haiku-4.5").

const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

/** The stored connection also applies to Messages API callers and background jobs. */
export async function getGatewayAnthropicClient(): Promise<Anthropic> {
  const credential = await getGatewayCredential();
  return new Anthropic({
    apiKey: null,
    authToken: credential.apiKey,
    baseURL: GATEWAY_BASE_URL,
    fetch: async (input, init) => {
      const current = await getGatewayCredential();
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${current.apiKey}`);
      headers.delete("x-api-key");
      if (current.teamIdOrSlug)
        headers.set("x-vercel-ai-gateway-team", current.teamIdOrSlug);
      return globalThis.fetch(input, { ...init, headers });
    },
  });
}
