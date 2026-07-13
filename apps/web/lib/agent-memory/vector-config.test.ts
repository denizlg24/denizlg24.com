import { describe, expect, test } from "bun:test";
import {
  AGENT_MEMORY_VECTOR_CONFIG,
  vectorIndexMatchesContract,
} from "./vector-config";

describe("agent memory vector contract", () => {
  test("matches a ready index with the exact vector and filter definition", () => {
    expect(
      vectorIndexMatchesContract({
        name: AGENT_MEMORY_VECTOR_CONFIG.indexName,
        status: "READY",
        queryable: true,
        latestDefinition: {
          fields: [
            {
              type: "vector",
              path: AGENT_MEMORY_VECTOR_CONFIG.path,
              numDimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
              similarity: AGENT_MEMORY_VECTOR_CONFIG.similarity,
              quantization: AGENT_MEMORY_VECTOR_CONFIG.quantization,
            },
            ...AGENT_MEMORY_VECTOR_CONFIG.filterPaths.map((path) => ({
              type: "filter",
              path,
            })),
          ],
        },
      }),
    ).toBe(true);
  });

  test("rejects building, dimension-mismatched, or under-filtered indexes", () => {
    expect(
      vectorIndexMatchesContract({
        name: AGENT_MEMORY_VECTOR_CONFIG.indexName,
        status: "BUILDING",
        queryable: false,
      }),
    ).toBe(false);
    expect(
      vectorIndexMatchesContract({
        name: AGENT_MEMORY_VECTOR_CONFIG.indexName,
        status: "READY",
        queryable: true,
        definition: {
          fields: [
            {
              type: "vector",
              path: "vector",
              numDimensions: 768,
              similarity: "cosine",
              quantization: "scalar",
            },
          ],
        },
      }),
    ).toBe(false);
  });

  test("rejects an index whose vector matches but omits some filter paths", () => {
    expect(
      vectorIndexMatchesContract({
        name: AGENT_MEMORY_VECTOR_CONFIG.indexName,
        status: "READY",
        queryable: true,
        latestDefinition: {
          fields: [
            {
              type: "vector",
              path: AGENT_MEMORY_VECTOR_CONFIG.path,
              numDimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
              similarity: AGENT_MEMORY_VECTOR_CONFIG.similarity,
              quantization: AGENT_MEMORY_VECTOR_CONFIG.quantization,
            },
            // Only the first contract filter path is present; the rest are missing.
            {
              type: "filter",
              path: AGENT_MEMORY_VECTOR_CONFIG.filterPaths[0],
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
