import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  messageContentToStored,
  sanitizeStoredMessageContent,
} from "./llm-message-storage";

describe("LLM message storage", () => {
  test("persists the text summary from an image tool result", () => {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "tool_result",
        tool_use_id: "tool-view-board",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "large-base64-image",
            },
          },
          { type: "text", text: '{"success":true,"name":"CG"}' },
        ],
      },
    ];

    expect(messageContentToStored(content)).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool-view-board",
        content: '{"success":true,"name":"CG"}',
        is_error: undefined,
      },
    ]);
  });

  test("repairs legacy tool results whose image content was discarded", () => {
    expect(
      sanitizeStoredMessageContent([
        {
          type: "tool_result",
          tool_use_id: "tool-view-board",
        },
      ]),
    ).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool-view-board",
        content: "(Tool result content was not retained.)",
      },
    ]);
  });

  test("round-trips image results as valid textual tool results", () => {
    const original: Anthropic.ContentBlockParam[] = [
      {
        type: "tool_result",
        tool_use_id: "tool-view-board",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "large-base64-image",
            },
          },
          { type: "text", text: "Rendered CG whiteboard." },
        ],
      },
    ];

    const stored = messageContentToStored(original);
    expect(typeof stored).not.toBe("string");
    expect(sanitizeStoredMessageContent(stored)).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool-view-board",
        content: "Rendered CG whiteboard.",
      },
    ]);
  });

  test("keeps the url of an attached image so it stays reachable later", () => {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "image",
        source: { type: "url", url: "https://storage.example/photo.png" },
      },
      { type: "text", text: "this is me" },
    ];

    expect(messageContentToStored(content)).toEqual([
      {
        type: "image",
        source: { type: "url", url: "https://storage.example/photo.png" },
      },
      { type: "text", text: "this is me" },
    ]);
  });

  test("keeps the url and name of an attached document", () => {
    const content = [
      {
        type: "document",
        name: "notes.pdf",
        source: { type: "url", url: "https://storage.example/notes.pdf" },
      },
    ] as unknown as Anthropic.ContentBlockParam[];

    expect(messageContentToStored(content)).toEqual([
      {
        type: "document",
        name: "notes.pdf",
        source: { type: "url", url: "https://storage.example/notes.pdf" },
      },
    ]);
  });

  test("uses the Anthropic document title as the stored attachment name", () => {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "document",
        title: "background-notes.pdf",
        source: {
          type: "url",
          url: "https://storage.example/background-notes.pdf",
        },
      },
    ];

    expect(messageContentToStored(content)).toEqual([
      {
        type: "document",
        name: "background-notes.pdf",
        source: {
          type: "url",
          url: "https://storage.example/background-notes.pdf",
        },
      },
    ]);
  });

  test("restores URL-backed attachments for later model turns", () => {
    expect(
      sanitizeStoredMessageContent([
        {
          type: "image",
          source: { type: "url", url: "https://storage.example/me.jpg" },
        },
        {
          type: "document",
          name: "notes.pdf",
          source: { type: "url", url: "https://storage.example/notes.pdf" },
        },
        { type: "text", text: "Remember these." },
      ]),
    ).toEqual([
      {
        type: "image",
        source: { type: "url", url: "https://storage.example/me.jpg" },
      },
      {
        type: "document",
        source: { type: "url", url: "https://storage.example/notes.pdf" },
        title: "notes.pdf",
      },
      { type: "text", text: "Remember these." },
    ]);
  });

  test("does not restore attachment placeholders that have no durable URL", () => {
    expect(
      sanitizeStoredMessageContent([
        { type: "image" },
        { type: "document", name: "lost.pdf" },
        { type: "text", text: "Still valid." },
      ]),
    ).toEqual([{ type: "text", text: "Still valid." }]);
  });

  test("drops inline base64 payloads instead of bloating the conversation", () => {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "large-base64-image",
        },
      },
    ];

    expect(messageContentToStored(content)).toEqual([{ type: "image" }]);
  });
});
