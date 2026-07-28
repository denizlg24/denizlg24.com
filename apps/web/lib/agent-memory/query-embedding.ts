import type { EmbedMultimodalRequest } from "@/lib/llm-service";
import { AGENT_MEMORY_VECTOR_CONFIG } from "./vector-config";

/**
 * Text recall queries must use Cohere's query-side multimodal transport. The
 * paired stored memories use `search_document`, including image-backed ones.
 */
export function agentMemoryQueryEmbeddingRequest(
  query: string,
  source: string,
): EmbedMultimodalRequest {
  return {
    purpose: "agent-memory-retrieval",
    source,
    model: AGENT_MEMORY_VECTOR_CONFIG.model,
    dimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
    inputType: "search_query",
    inputs: [{ text: query }],
  };
}
