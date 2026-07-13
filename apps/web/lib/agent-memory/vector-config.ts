export const AGENT_MEMORY_VECTOR_CONFIG = {
  collection: "agent_memory_embeddings",
  indexName: "agent_memory_vector_v1",
  path: "vector",
  model: "openai/text-embedding-3-small",
  dimensions: 1_536,
  similarity: "cosine",
  quantization: "scalar",
  filterPaths: ["model", "sensitivity", "status", "memoryType", "validUntil"],
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

export function vectorIndexMatchesContract(
  index: SearchIndexDescription,
): boolean {
  if (
    index.name !== AGENT_MEMORY_VECTOR_CONFIG.indexName ||
    index.status !== "READY" ||
    index.queryable !== true
  ) {
    return false;
  }
  const fields = index.latestDefinition?.fields ?? index.definition?.fields;
  if (!fields) return false;
  const vector = fields.find((field) => field.type === "vector");
  if (
    vector?.path !== AGENT_MEMORY_VECTOR_CONFIG.path ||
    vector.numDimensions !== AGENT_MEMORY_VECTOR_CONFIG.dimensions ||
    vector.similarity !== AGENT_MEMORY_VECTOR_CONFIG.similarity ||
    vector.quantization !== AGENT_MEMORY_VECTOR_CONFIG.quantization
  ) {
    return false;
  }
  const filters = new Set(
    fields
      .filter((field) => field.type === "filter")
      .map((field) => field.path),
  );
  return AGENT_MEMORY_VECTOR_CONFIG.filterPaths.every((path) =>
    filters.has(path),
  );
}
