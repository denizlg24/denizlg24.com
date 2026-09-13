import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import { convertToModelMessages } from "ai";
import { normalizeAgentMessage } from "./messages";

describe("normalizeAgentMessage", () => {
  test("removes a nullable providerExecuted value before prompt conversion", async () => {
    const malformed: AgentUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-navigate_desktop",
          toolCallId: "call_1",
          state: "output-available",
          input: { path: "/dashboard/notes" },
          output: { ok: true, path: "/dashboard/notes" },
        },
      ],
    };
    Object.assign(malformed.parts[0] ?? {}, { providerExecuted: null });

    const normalized = normalizeAgentMessage(malformed);
    expect(normalized.parts[0]).not.toHaveProperty("providerExecuted");

    const converted = await convertToModelMessages([normalized]);
    expect(converted).toHaveLength(2);
    expect(converted[0]?.role).toBe("assistant");
    expect(converted[1]?.role).toBe("tool");
  });
});
