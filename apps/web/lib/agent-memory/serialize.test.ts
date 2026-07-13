import { describe, expect, test } from "bun:test";
import { agentMemoryRunSchema, agentMemorySettingsSchema } from "@repo/schemas";
import type { IAgentMemoryRun } from "@/models/AgentMemoryRun";
import { DEFAULT_AGENT_MEMORY_SETTINGS } from "@/models/AgentMemorySettings";
import {
  serializeAgentMemoryRun,
  serializeAgentMemorySettings,
} from "./serialize";

describe("agent memory wire serialization", () => {
  test("serializes default settings through the shared contract", () => {
    const settings = serializeAgentMemorySettings({
      ...structuredClone(DEFAULT_AGENT_MEMORY_SETTINGS),
      updatedAt: new Date("2026-07-13T10:00:00.000Z"),
    });
    expect(agentMemorySettingsSchema.parse(settings)).toEqual(settings);
    expect(settings.releaseGates).toEqual({
      evidenceLedger: false,
      formation: false,
      shadowRetrieval: false,
      chatMemory: false,
      reflection: false,
      proactivity: false,
    });
  });

  test("omits incomplete legacy run usage subdocuments", () => {
    const run = serializeAgentMemoryRun({
      _id: "run-id",
      operation: "reflection",
      status: "completed",
      promptVersion: "reflection-v1",
      schemaVersion: "1",
      inputIds: [],
      outputIds: [],
      usage: { costUsd: 0 } as IAgentMemoryRun["usage"],
      startedAt: new Date("2026-07-13T10:00:00.000Z"),
      completedAt: new Date("2026-07-13T10:00:01.000Z"),
      createdAt: new Date("2026-07-13T10:00:00.000Z"),
      updatedAt: new Date("2026-07-13T10:00:01.000Z"),
    });

    expect(agentMemoryRunSchema.parse(run)).toEqual(run);
    expect(run.usage).toBeUndefined();
  });
});
