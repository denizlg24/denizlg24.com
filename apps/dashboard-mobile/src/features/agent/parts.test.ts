import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import { blocksOf, describeInput } from "./parts";

describe("agent parts", () => {
  test("text, tools and notices become blocks; empty text is dropped", () => {
    const message: AgentUIMessage = {
      id: "m",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "  " },
        {
          type: "dynamic-tool",
          toolName: "denizlg24__web_emails",
          toolCallId: "t1",
          state: "input-available",
          input: { action: "send", to: "a@b.c" },
        },
        { type: "text", text: "Done." },
        { type: "data-notice", data: { level: "info", text: "Memory saved" } },
      ],
    };
    const blocks = blocksOf(message);
    expect(blocks.map((block) => block.kind)).toEqual([
      "tool",
      "text",
      "notice",
    ]);
    expect(blocks[0]).toMatchObject({ key: "t1", state: "input-available" });
    expect(blocks[0]?.kind === "tool" && blocks[0].label).toContain("send");
  });

  test("input reads as lines without the action and is bounded", () => {
    expect(describeInput({ action: "send", to: "a@b.c", cc: ["x"] })).toBe(
      'to: a@b.c\ncc: ["x"]',
    );
    expect(describeInput({ body: "x".repeat(1000) }, 50).length).toBe(51);
  });
});
