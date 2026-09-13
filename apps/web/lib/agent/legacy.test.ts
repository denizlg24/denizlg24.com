import { describe, expect, test } from "bun:test";
import type { IConversationMessage } from "@/models/Conversation";
import { agentEvidenceUnits } from "./evidence-units";
import { legacyToUIMessages } from "./legacy";

const at = new Date("2026-07-13T10:00:00.000Z");

const legacy: IConversationMessage[] = [
  {
    eventId: "e-user",
    role: "user",
    content: [
      { type: "text", text: "Show my notes" },
      {
        type: "image",
        name: "shot.png",
        source: { type: "url", url: "https://s/shot.png" },
      },
    ],
    createdAt: at,
  },
  {
    eventId: "e-asst-1",
    role: "assistant",
    content: [
      { type: "text", text: "Looking." },
      { type: "tool_use", id: "t1", name: "list_notes", input: { limit: 5 } },
    ],
    tokenUsage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
    createdAt: at,
  },
  {
    eventId: "e-tool-1",
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" }],
    createdAt: at,
  },
  {
    eventId: "e-asst-2",
    role: "assistant",
    content: [
      { type: "text", text: "None." },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [{ type: "web_search_result", url: "https://a", title: "A" }],
      },
    ],
    tokenUsage: { inputTokens: 20, outputTokens: 5, costUsd: 0.002 },
    retrievalTraceId: "trace-1",
    memoryInjected: true,
    createdAt: at,
  },
];

describe("legacyToUIMessages", () => {
  test("folds tool-result turns into one assistant message", () => {
    const messages = legacyToUIMessages(legacy);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "e-user",
      role: "user",
      parts: [
        { type: "text", text: "Show my notes" },
        {
          type: "file",
          mediaType: "image/png",
          url: "https://s/shot.png",
          filename: "shot.png",
        },
      ],
    });
    const assistant = messages[1];
    expect(assistant?.id).toBe("e-asst-1");
    expect(assistant?.parts.map((part) => part.type)).toEqual([
      "step-start",
      "text",
      "dynamic-tool",
      "step-start",
      "text",
      "source-url",
    ]);
    expect(assistant?.parts[2]).toMatchObject({
      toolName: "list_notes",
      toolCallId: "t1",
      state: "output-available",
      output: { content: [{ type: "text", text: "[]" }] },
    });
    expect(assistant?.metadata).toMatchObject({
      createdAt: at.toISOString(),
      retrievalTraceId: "trace-1",
      memoryInjected: true,
      usage: { inputTokens: 20 },
    });
  });

  test("marks a tool call that never got a result as failed", () => {
    const [assistant] = legacyToUIMessages([legacy[1] as IConversationMessage]);
    expect(assistant?.parts[2]).toMatchObject({
      state: "output-error",
      errorText: expect.stringContaining("Not completed"),
    });
  });

  test("evidence units of a converted thread keep the original event ids", () => {
    const units = agentEvidenceUnits(legacyToUIMessages(legacy));
    expect(units.map((unit) => unit.eventId)).toEqual([
      "e-user",
      "e-asst-1:text:1",
      "e-asst-1:tool:t1",
      "e-asst-1:text:4",
    ]);
    expect(units[2]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" }],
    });
  });
});
