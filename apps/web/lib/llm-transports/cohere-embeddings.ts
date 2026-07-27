import { LlmConfigurationError, LlmTransportError } from "@/lib/llm-errors";

/**
 * The one place in the codebase that talks to a provider outside the Vercel AI
 * Gateway, mirroring how `embeddings.ts` isolates the Gateway itself.
 *
 * The Gateway cannot carry this call. Its `/v1/embeddings` endpoint validates
 * the OpenAI-compatible `input` field and drops Cohere's `inputs`/`images`
 * fields, so multimodal embedding is unreachable through it even though the
 * upstream model supports it. See docs/internal/plans/attachment-memory.md.
 */
const COHERE_EMBED_URL = "https://api.cohere.com/v2/embed";

/** Namespace prefix stripped before the id reaches Cohere. */
const COHERE_MODEL_PREFIX = "cohere/";

/**
 * Cohere distinguishes stored documents from queries and embeds them
 * differently. Using one where the other belongs measurably degrades recall.
 */
export type CohereEmbedInputType = "search_document" | "search_query";

export interface MultimodalEmbeddingInput {
  text?: string;
  /** Base64 data URI. Cohere does not fetch remote URLs. */
  image?: string;
}

export interface MultimodalEmbeddingRequest {
  model: string;
  inputs: MultimodalEmbeddingInput[];
  dimensions: number;
  inputType: CohereEmbedInputType;
}

export interface MultimodalEmbeddingResult {
  vectors: number[][];
  inputTokens: number;
  imageTokens: number;
}

interface CohereEmbedResponseBody {
  embeddings?: { float?: unknown };
  meta?: { billed_units?: { input_tokens?: number; image_tokens?: number } };
  message?: string;
}

function toCohereContent(input: MultimodalEmbeddingInput) {
  const content: Array<
    { type: "text"; text: string } | { type: "image"; image: string }
  > = [];
  if (input.text?.trim()) content.push({ type: "text", text: input.text });
  if (input.image) content.push({ type: "image", image: input.image });
  return content;
}

export async function requestMultimodalEmbedding({
  model,
  inputs,
  dimensions,
  inputType,
}: MultimodalEmbeddingRequest): Promise<MultimodalEmbeddingResult> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new LlmConfigurationError(
      "COHERE_API_KEY is not configured; multimodal embedding is unavailable",
    );
  }
  if (inputs.length === 0) {
    throw new LlmTransportError("Multimodal embedding requires an input");
  }

  const content = inputs.map(toCohereContent);
  if (content.some((entry) => entry.length === 0)) {
    throw new LlmTransportError(
      "Every multimodal embedding input needs text, an image, or both",
    );
  }

  const response = await fetch(COHERE_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.startsWith(COHERE_MODEL_PREFIX)
        ? model.slice(COHERE_MODEL_PREFIX.length)
        : model,
      input_type: inputType,
      embedding_types: ["float"],
      output_dimension: dimensions,
      inputs: content.map((entry) => ({ content: entry })),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LlmTransportError(
      `Multimodal embedding request failed: ${response.status} ${text}`.trim(),
      response.status,
    );
  }

  const body = (await response.json()) as CohereEmbedResponseBody;
  const vectors = body.embeddings?.float;
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
    throw new LlmTransportError(
      `Multimodal embedding response did not contain ${inputs.length} vectors`,
    );
  }
  for (const vector of vectors) {
    if (
      !Array.isArray(vector) ||
      vector.length !== dimensions ||
      vector.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new LlmTransportError(
        `Multimodal embedding response did not contain ${dimensions} finite dimensions`,
      );
    }
  }

  return {
    vectors: vectors as number[][],
    inputTokens: body.meta?.billed_units?.input_tokens ?? 0,
    imageTokens: body.meta?.billed_units?.image_tokens ?? 0,
  };
}
