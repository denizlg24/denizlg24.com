import { describe, expect, test } from "bun:test";
import { agentMemoryQueryEmbeddingRequest } from "./query-embedding";
import { AGENT_MEMORY_VECTOR_CONFIG } from "./vector-config";

describe("agentMemoryQueryEmbeddingRequest", () => {
  test("uses the multimodal query side of the deployed vector contract", () => {
    expect(
      agentMemoryQueryEmbeddingRequest(
        "show me my profile photo",
        "agent-memory-explore",
      ),
    ).toEqual({
      purpose: "agent-memory-retrieval",
      source: "agent-memory-explore",
      model: AGENT_MEMORY_VECTOR_CONFIG.model,
      dimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
      inputType: "search_query",
      inputs: [{ text: "show me my profile photo" }],
    });
  });
});
