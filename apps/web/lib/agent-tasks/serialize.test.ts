import { describe, expect, test } from "bun:test";
import { agentTaskSchema } from "@repo/schemas";
import { Types } from "mongoose";
import type { IAgentTask } from "@/models/AgentTask";
import { serializeAgentTask } from "./serialize";

const now = new Date("2026-08-03T12:00:00.000Z");

function task(overrides: Partial<IAgentTask> = {}) {
  return {
    _id: new Types.ObjectId("507f1f77bcf86cd799439012"),
    name: "Portfolio review",
    prompt: "Review the portfolio.",
    attachments: [],
    llmModel: "anthropic/claude-opus-4.7",
    memoryMode: "enabled",
    status: "active",
    maxRounds: 40,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as IAgentTask;
}

describe("serializeAgentTask", () => {
  test("emits a contract-valid scheduled task", () => {
    const serialized = serializeAgentTask(
      task({
        schedule: { cron: "0 9 * * 1-5", timeZone: "Europe/Lisbon" },
        nextRunAt: now,
      }),
    );
    expect(agentTaskSchema.parse(serialized).schedule).toEqual({
      cron: "0 9 * * 1-5",
      timeZone: "Europe/Lisbon",
    });
  });

  test("reports a manual-only task as a null schedule, not a missing key", () => {
    const serialized = serializeAgentTask(task());
    expect(serialized.schedule).toBeNull();
    expect(serialized.nextRunAt).toBeUndefined();
    expect(agentTaskSchema.safeParse(serialized).success).toBe(true);
  });
});
