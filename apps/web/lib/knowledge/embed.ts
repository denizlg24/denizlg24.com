import { embedMultimodal } from "@/lib/llm-service";
import { KNOWLEDGE_VECTOR_CONFIG } from "./vector-config";

// Cohere accepts at most 96 inputs per request; stay well under it so a batch
// of 512-token chunks also stays under the payload limit.
const EMBED_BATCH_SIZE = 32;

/** Embeds chunk texts as `search_document`, in order, one request per batch. */
export async function embedChunkTexts(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const result = await embedMultimodal({
      purpose: "agent-memory-embedding",
      source: "knowledge-chunk-embedding",
      model: KNOWLEDGE_VECTOR_CONFIG.model,
      dimensions: KNOWLEDGE_VECTOR_CONFIG.dimensions,
      inputType: "search_document",
      inputs: batch.map((text) => ({ text })),
    });
    if (result.vectors.length !== batch.length) {
      throw new Error("Embedding returned the wrong number of vectors");
    }
    vectors.push(...result.vectors);
  }
  return vectors;
}

export async function embedKnowledgeQuery(query: string): Promise<number[]> {
  const result = await embedMultimodal({
    purpose: "agent-memory-retrieval",
    source: "knowledge-retrieval",
    model: KNOWLEDGE_VECTOR_CONFIG.model,
    dimensions: KNOWLEDGE_VECTOR_CONFIG.dimensions,
    inputType: "search_query",
    inputs: [{ text: query }],
  });
  const vector = result.vectors[0];
  if (!vector) throw new Error("Embedding returned no vector");
  return vector;
}
