import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const { POST } = await import("./route");

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
});
