import { describe, expect, test } from "bun:test";
import { agentTrainingRunSchema } from "@repo/schemas";
import { AgentTrainingRun } from "@/models/AgentTrainingRun";
import { serializeTrainingRun } from "./serialize";

const timestamp = new Date("2026-07-20T12:00:00.000Z");

function createRun(tokenUsage?: Record<string, number>) {
  return new AgentTrainingRun({
    taskId: "507f1f77bcf86cd799439011",
    taskName: "Daily research",
    trigger: "manual",
    status: "queued",
    scheduledFor: timestamp,
    toolCalls: [],
    tokenUsage,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

describe("serializeTrainingRun", () => {
  test("omits incomplete token usage from legacy queued runs", () => {
    const serialized = serializeTrainingRun(createRun({}));

    expect(serialized.tokenUsage).toBeUndefined();
    expect(agentTrainingRunSchema.safeParse(serialized).success).toBe(true);
  });

  test("preserves complete token usage", () => {
    const serialized = serializeTrainingRun(
      createRun({ inputTokens: 12, outputTokens: 8, costUsd: 0.004 }),
    );

    expect(serialized.tokenUsage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      costUsd: 0.004,
    });
  });
});
