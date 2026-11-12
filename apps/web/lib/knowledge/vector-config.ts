/**
 * Same embedding contract as agent memory: one model, 1536 cosine dimensions,
 * scalar quantization. Every query filters on `model`, so switching models is
 * a re-embed migration (old chunks stay and are never matched).
 */
export const KNOWLEDGE_VECTOR_CONFIG = {
  collection: "knowledge_chunks",
  indexName: "knowledge_chunks_vector_v1",
  path: "vector",
  model: "cohere/embed-v4.0",
  dimensions: 1_536,
  similarity: "cosine",
  quantization: "scalar",
  filterPaths: ["model", "sourceKey", "sourceKind", "status"],
} as const;

interface SearchIndexField {
  type?: string;
  path?: string;
  numDimensions?: number;
  similarity?: string;
  quantization?: string;
}

interface SearchIndexDescription {
  name?: string;
  status?: string;
  queryable?: boolean;
  definition?: { fields?: SearchIndexField[] };
  latestDefinition?: { fields?: SearchIndexField[] };
}

export function knowledgeIndexDefinition() {
  return {
    fields: [
      {
        type: "vector",
        path: KNOWLEDGE_VECTOR_CONFIG.path,
        numDimensions: KNOWLEDGE_VECTOR_CONFIG.dimensions,
        similarity: KNOWLEDGE_VECTOR_CONFIG.similarity,
        quantization: KNOWLEDGE_VECTOR_CONFIG.quantization,
      },
      ...KNOWLEDGE_VECTOR_CONFIG.filterPaths.map((path) => ({
        type: "filter",
        path,
      })),
    ],
  };
}

export function knowledgeVectorIndexMatchesContract(
  index: SearchIndexDescription,
): boolean {
  if (
    index.name !== KNOWLEDGE_VECTOR_CONFIG.indexName ||
    index.status !== "READY" ||
    index.queryable !== true
  ) {
    return false;
  }
  const fields = index.latestDefinition?.fields ?? index.definition?.fields;
  if (!fields) return false;
  const vector = fields.find((field) => field.type === "vector");
  if (
    vector?.path !== KNOWLEDGE_VECTOR_CONFIG.path ||
    vector.numDimensions !== KNOWLEDGE_VECTOR_CONFIG.dimensions ||
    vector.similarity !== KNOWLEDGE_VECTOR_CONFIG.similarity ||
    vector.quantization !== KNOWLEDGE_VECTOR_CONFIG.quantization
  ) {
    return false;
  }
  const filters = new Set(
    fields.filter((field) => field.type === "filter").map((f) => f.path),
  );
  return KNOWLEDGE_VECTOR_CONFIG.filterPaths.every((path) => filters.has(path));
}

export async function probeKnowledgeVectorBackend(): Promise<boolean> {
  const { KnowledgeChunk } = await import("@/models/KnowledgeChunk");
  try {
    const indexes = await KnowledgeChunk.collection
      .listSearchIndexes()
      .toArray();
    return indexes.some(knowledgeVectorIndexMatchesContract);
  } catch (error) {
    console.error("probeKnowledgeVectorBackend failed", error);
    return false;
  }
}
