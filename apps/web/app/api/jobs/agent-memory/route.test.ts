import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { POST, preferredOperationsForSlot } = await import("./route");

describe("POST /api/jobs/agent-memory", () => {
  const originalToken = process.env.AGENT_MEMORY_JOB_BEARER_TOKEN;

  beforeEach(() => {
    process.env.AGENT_MEMORY_JOB_BEARER_TOKEN = "test-agent-memory-token";
  });

  afterAll(() => {
    process.env.AGENT_MEMORY_JOB_BEARER_TOKEN = originalToken;
  });

  test("rejects a missing bearer token before reading jobs", async () => {
    const response = await POST(
      new Request("http://localhost/api/jobs/agent-memory", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  test("reserves worker capacity for embeddings, formation, and reflection", () => {
    expect(preferredOperationsForSlot(0)).toEqual([
      "embedding",
      "embedding-cleanup",
    ]);
    expect(preferredOperationsForSlot(1)).toEqual(["formation", "backfill"]);
    expect(preferredOperationsForSlot(2)).toEqual([
      "training",
      "chat-run",
      "reflection",
      "insight",
      "consolidation",
      "resource-suggestion",
    ]);
    expect(preferredOperationsForSlot(8)).toEqual([
      "training",
      "chat-run",
      "reflection",
      "insight",
      "consolidation",
      "resource-suggestion",
    ]);
    expect(preferredOperationsForSlot(9)).toEqual([
      "embedding",
      "embedding-cleanup",
    ]);
  });
});
