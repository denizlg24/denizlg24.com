import { describe, expect, test } from "bun:test";
import {
  type AgentUIMessage,
  agentTaskRunSchema,
  agentTaskSchema,
} from "@repo/schemas";
import { Types } from "mongoose";
import type { IAgentTask } from "@/models/AgentTask";
import type { IAgentTaskRun } from "@/models/AgentTaskRun";
import {
  serializeAgentTask,
  serializeAgentTaskRun,
  serializeAgentTaskRunSummary,
} from "./serialize";

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

function run(overrides: Partial<IAgentTaskRun> = {}) {
  return {
    _id: new Types.ObjectId("507f1f77bcf86cd799439013"),
    taskId: new Types.ObjectId("507f1f77bcf86cd799439012"),
    taskName: "Portfolio review",
    trigger: "manual",
    status: "completed",
    scheduledFor: now,
    startedAt: now,
    completedAt: now,
    messages: [],
    toolCallCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as IAgentTaskRun;
}

describe("serializeAgentTaskRun", () => {
  test("returns the stored transcript and a count the list can show", () => {
    const messages: AgentUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Go" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "web_notes",
            toolCallId: "c1",
            state: "output-available",
            input: { action: "list" },
            output: { content: [{ type: "text", text: "[]" }] },
          },
          { type: "text", text: "Nothing to do.\n\nDetails follow." },
        ],
      },
    ];
    const stored = run({
      messages,
      toolCallCount: 1,
      output: "Nothing to do.\n\nDetails follow.",
    });
    const serialized = agentTaskRunSchema.parse(serializeAgentTaskRun(stored));
    expect(serialized.messages).toEqual(messages);
    const summary = serializeAgentTaskRunSummary(stored);
    expect(summary.toolCalls).toBe(1);
    expect(summary.outputPreview).toBe("Nothing to do.");
    expect("messages" in summary).toBe(false);
  });

  test("rebuilds a legacy run's flat audit rows as one assistant message", () => {
    const stored = run({
      messages: [],
      toolCallCount: 0,
      output: "Done.",
      toolCalls: [
        {
          toolUseId: "t1",
          name: "list_notes",
          isWrite: false,
          input: { limit: 5 },
          result: "[]",
          isError: false,
        },
        {
          toolUseId: "t2",
          name: "create_note",
          isWrite: true,
          input: { title: "x" },
          result: "boom",
          isError: true,
        },
      ],
    });
    const serialized = agentTaskRunSchema.parse(serializeAgentTaskRun(stored));
    expect(serialized.messages).toHaveLength(1);
    const [message] = serialized.messages;
    expect(message?.role).toBe("assistant");
    expect(message?.parts.map((part) => part.type)).toEqual([
      "dynamic-tool",
      "dynamic-tool",
      "text",
    ]);
    expect(message?.parts[1]).toMatchObject({
      state: "output-error",
      errorText: "boom",
    });
    expect(serializeAgentTaskRunSummary(stored).toolCalls).toBe(2);
  });
});
