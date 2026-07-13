import { LlmConfigurationError, LlmTransportError } from "@/lib/llm-errors";

const GATEWAY_EMBEDDINGS_URL = "https://ai-gateway.vercel.sh/v1/embeddings";

export interface EmbeddingRequest {
  model: string;
  input: string;
  dimensions: number;
}

export interface EmbeddingResult {
  vector: number[];
  inputTokens: number;
}

interface EmbeddingResponseBody {
  data?: Array<{ embedding?: unknown }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

export async function requestEmbedding({
  model,
  input,
  dimensions,
}: EmbeddingRequest): Promise<EmbeddingResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new LlmConfigurationError(
      "AI_GATEWAY_API_KEY is not configured; embedding generation is unavailable",
    );
  }
  const response = await fetch(GATEWAY_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input, dimensions }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LlmTransportError(
      `Embedding request failed: ${response.status} ${text}`.trim(),
      response.status,
    );
  }
  const body = (await response.json()) as EmbeddingResponseBody;
  const vector = body.data?.[0]?.embedding;
  if (
    !Array.isArray(vector) ||
    vector.length !== dimensions ||
    vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new LlmTransportError(
      `Embedding response did not contain ${dimensions} finite dimensions`,
    );
  }
  return {
    vector,
    inputTokens: body.usage?.prompt_tokens ?? body.usage?.total_tokens ?? 0,
  };
}
