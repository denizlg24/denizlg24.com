import Anthropic from "@anthropic-ai/sdk";
import { LlmConfigurationError } from "@/lib/llm-errors";

// The only place an Anthropic SDK client is constructed. It talks to the
// Vercel AI Gateway's Anthropic-compatible Messages endpoint, so model ids
// are fully qualified Gateway ids (e.g. "anthropic/claude-haiku-4.5").

const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

let client: Anthropic | null = null;
let clientKey: string | null = null;

/**
 * Lazily builds the Gateway Messages client. The key is validated here — at
 * the start of a generation/counting operation — never at module import, so
 * discovery and tests run without credentials.
 */
export function getGatewayAnthropicClient(): Anthropic {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new LlmConfigurationError(
      "AI_GATEWAY_API_KEY is not configured; LLM generation is unavailable",
    );
  }
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({
      apiKey,
      baseURL: GATEWAY_BASE_URL,
      // Resolve fetch at call time so runtime fetch replacements (tests,
      // tracing) are honored even though the client instance is cached.
      fetch: (input, init) => globalThis.fetch(input, init),
    });
    clientKey = apiKey;
  }
  return client;
}
