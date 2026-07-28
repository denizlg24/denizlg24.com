import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { injectMemoryImages } from "./message-images";

const image = {
  eventId: "event-a",
  url: "https://storage.example/me.jpg",
  name: "portrait.jpg",
};

describe("memory image message injection", () => {
  test("adds an image to the latest genuine user turn", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "What do I look like?" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-a",
            name: "lookup",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-a",
            content: "done",
          },
        ],
      },
    ];

    const result = injectMemoryImages(messages, [image]);
    expect(result.messageIndex).toBe(0);
    expect(result.originalContent).toBe("What do I look like?");
    expect(result.messages[0]?.content).toEqual([
      { type: "text", text: "What do I look like?" },
      {
        type: "text",
        text: expect.stringContaining("recalled_memory_image"),
      },
      {
        type: "image",
        source: { type: "url", url: image.url },
      },
    ]);
    expect(messages[0]?.content).toBe("What do I look like?");
  });

  test("does not inject an image already present in conversation history", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: image.url } },
          { type: "text", text: "This is me." },
        ],
      },
      { role: "assistant", content: "I see it." },
      { role: "user", content: "Describe it again." },
    ];
    const result = injectMemoryImages(messages, [image]);
    expect(result.messageIndex).toBeNull();
    expect(result.messages).toBe(messages);
  });
});
