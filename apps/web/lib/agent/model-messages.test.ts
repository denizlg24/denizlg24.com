import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { withBoundedToolImages } from "./model-messages";

function screenshot(id: string, url?: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "browser__browser_take_screenshot",
        output: {
          type: "content",
          value: [
            { type: "text", text: `shot ${id}` },
            {
              type: "file",
              mediaType: "image/jpeg",
              data: url
                ? { type: "url", url: new URL(url) }
                : { type: "data", data: "AAAA" },
            },
          ],
        },
      },
    ],
  };
}

function imageCount(messages: ModelMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const result of message.content) {
      if (result.type !== "tool-result" || result.output.type !== "content") {
        continue;
      }
      count += result.output.value.filter(
        (part) => part.type === "file",
      ).length;
    }
  }
  return count;
}

describe("withBoundedToolImages", () => {
  test("leaves a short history untouched", () => {
    const messages = [screenshot("a"), screenshot("b")];
    expect(withBoundedToolImages(messages, 3)).toBe(messages);
  });

  test("keeps only the newest images as pixels and names the rest", () => {
    const messages = [
      { role: "user", content: "go" } as ModelMessage,
      screenshot("a", "https://files.test/a.jpg"),
      screenshot("b"),
      screenshot("c", "https://files.test/c.jpg"),
      screenshot("d"),
    ];
    const bounded = withBoundedToolImages(messages, 2);
    expect(imageCount(bounded)).toBe(2);
    expect(imageCount(messages)).toBe(4);
    const first = bounded[1];
    expect(
      first?.role === "tool" &&
        first.content[0]?.type === "tool-result" &&
        first.content[0].output.type === "content" &&
        first.content[0].output.value[1],
    ).toEqual({
      type: "text",
      text: "[earlier screenshot, not shown again: https://files.test/a.jpg]",
    });
    const second = bounded[2];
    expect(
      second?.role === "tool" &&
        second.content[0]?.type === "tool-result" &&
        second.content[0].output.type === "content" &&
        second.content[0].output.value[1],
    ).toEqual({ type: "text", text: "[earlier screenshot, not shown again]" });
    expect(bounded[3]).toBe(messages[3]);
    expect(bounded[4]).toBe(messages[4]);
  });

  test("ignores non-image files and text outputs", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "p",
            toolName: "browser__browser_pdf_save",
            output: {
              type: "content",
              value: [
                {
                  type: "file",
                  mediaType: "application/pdf",
                  data: { type: "data", data: "AAAA" },
                },
              ],
            },
          },
          {
            type: "tool-result",
            toolCallId: "t",
            toolName: "x",
            output: { type: "text", value: "plain" },
          },
        ],
      },
      screenshot("a"),
    ];
    expect(withBoundedToolImages(messages, 0)).toMatchObject([
      messages[0] as object,
      {
        role: "tool",
        content: [
          {
            output: {
              value: [
                { type: "text", text: "shot a" },
                { type: "text", text: "[earlier screenshot, not shown again]" },
              ],
            },
          },
        ],
      },
    ]);
  });
});
