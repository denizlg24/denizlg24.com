import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import {
  buildAgentBlocks,
  shouldContinueAgentTurn,
  spokenReplyText,
  toolTitle,
} from "./agent-parts";

const user: AgentUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hi" }],
};

function assistant(parts: AgentUIMessage["parts"]): AgentUIMessage {
  return { id: "a1", role: "assistant", parts };
}

describe("shouldContinueAgentTurn", () => {
  test("waits while an approval is still open", () => {
    const messages = [
      user,
      assistant([
        { type: "step-start" },
        {
          type: "dynamic-tool",
          toolName: "denizlg24__web_notes",
          toolCallId: "c1",
          state: "approval-requested",
          input: { action: "delete" },
          approval: { id: "ap1" },
        },
      ]),
    ];
    expect(shouldContinueAgentTurn({ messages })).toBe(false);
  });

  test("continues once a manual approval is answered", () => {
    const messages = [
      user,
      assistant([
        { type: "step-start" },
        {
          type: "dynamic-tool",
          toolName: "denizlg24__web_notes",
          toolCallId: "c1",
          state: "approval-responded",
          input: { action: "delete" },
          approval: { id: "ap1", approved: true },
        },
      ]),
    ];
    expect(shouldContinueAgentTurn({ messages })).toBe(true);
  });

  test("continues once every page tool has output", () => {
    const messages = [
      user,
      assistant([
        { type: "step-start" },
        {
          type: "tool-get_current_page_context",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { pathname: "/dashboard" },
        },
      ]),
    ];
    expect(shouldContinueAgentTurn({ messages })).toBe(true);
  });

  test("does not resubmit after the continuation has answered", () => {
    const messages = [
      user,
      assistant([
        { type: "step-start" },
        {
          type: "tool-navigate_desktop",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "/dashboard/notes" },
          output: { ok: true },
        },
        { type: "step-start" },
        { type: "text", text: "Opened notes.", state: "done" },
      ]),
    ];
    expect(shouldContinueAgentTurn({ messages })).toBe(false);
  });

  test("ignores automatic approval decisions", () => {
    const messages = [
      user,
      assistant([
        { type: "step-start" },
        {
          type: "dynamic-tool",
          toolName: "denizlg24__web_notes",
          toolCallId: "c1",
          state: "approval-responded",
          input: { action: "list" },
          approval: { id: "ap1", approved: true, isAutomatic: true },
        },
      ]),
    ];
    expect(shouldContinueAgentTurn({ messages })).toBe(false);
  });
});

describe("spokenReplyText", () => {
  test("speaks the answer after a tool, not the earlier progress message", () => {
    const reply = assistant([
      { type: "text", text: "Okay, I'm looking at your notes.", state: "done" },
      {
        type: "dynamic-tool",
        toolName: "denizlg24__web_notes",
        toolCallId: "c1",
        state: "output-available",
        input: { action: "list" },
        output: { notes: [] },
      },
      { type: "step-start" },
      {
        type: "text",
        text: "I found three notes from this week.",
        state: "done",
      },
    ]);
    expect(spokenReplyText(reply)).toBe("I found three notes from this week.");
  });

  test("does not read a tool call or its preamble as the answer", () => {
    expect(
      spokenReplyText(
        assistant([
          { type: "text", text: "Let me check.", state: "done" },
          {
            type: "tool-get_current_page_context",
            toolCallId: "c1",
            state: "input-available",
            input: {},
          },
        ]),
      ),
    ).toBe("");
  });
});

describe("buildAgentBlocks", () => {
  test("places step sources after the web tool and separates touching text", () => {
    const blocks = buildAgentBlocks(
      assistant([
        { type: "step-start" },
        {
          type: "tool-web_search",
          toolCallId: "w1",
          state: "output-available",
          providerExecuted: true,
          input: { query: "x" },
          output: {},
        },
        { type: "text", text: "First.", state: "done" },
        { type: "source-url", sourceId: "s1", url: "https://a.dev" },
        { type: "step-start" },
        { type: "text", text: "Second.", state: "done" },
      ]),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "web",
      "sources",
      "text",
      "divider",
      "text",
    ]);
  });
});

describe("toolTitle", () => {
  test("humanises primary connector action tools", () => {
    expect(
      toolTitle({
        type: "dynamic-tool",
        toolName: "denizlg24__web_notes",
        toolCallId: "c1",
        state: "input-available",
        input: { action: "list" },
        toolMetadata: {
          connector: "denizlg24",
          connectorName: "denizlg24",
          toolName: "web_notes",
        },
      }),
    ).toBe("Notes · list");
  });
});
