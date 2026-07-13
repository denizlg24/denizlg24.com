import { describe, expect, test } from "bun:test";
import { agentMemorySettingsSchema } from "@repo/schemas";
import { DEFAULT_AGENT_MEMORY_SETTINGS } from "@/models/AgentMemorySettings";
import { serializeAgentMemorySettings } from "./serialize";

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
});
