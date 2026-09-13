import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import {
  AgentMergeError,
  applyClientDecisions,
  hasPendingWork,
  sanitizeUserMessage,
  truncateForRegenerate,
} from "./merge";

const waiting: AgentUIMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "text", text: "Deleting it." },
    {
      type: "dynamic-tool",
      toolName: "denizlg24__web_notes",
      toolCallId: "call_1",
      state: "approval-requested",
      input: { action: "delete", id: "n1" },
      approval: { id: "appr_1" },
    },
    {
      type: "tool-navigate_desktop",
      toolCallId: "call_2",
      state: "input-available",
      input: { path: "/dashboard/notes" },
    },
  ],
};
const stored: AgentUIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
  waiting,
];

describe("sanitizeUserMessage", () => {
  test("keeps text and http/data files, drops everything else", () => {
    const clean = sanitizeUserMessage({
      id: "u2",
      role: "user",
      parts: [
        { type: "text", text: "  look  " },
        { type: "file", mediaType: "image/png", url: "https://x/y.png" },
        { type: "file", mediaType: "image/png", url: "javascript:alert(1)" },
        { type: "step-start" },
        { type: "data-notice", data: { level: "info", text: "x" } },
      ],
      metadata: { usage: { inputTokens: 9, outputTokens: 9, costUsd: 1 } },
    });
    expect(clean.parts).toEqual([
      { type: "text", text: "  look  " },
      { type: "file", mediaType: "image/png", url: "https://x/y.png" },
    ]);
    expect(clean.metadata?.usage).toBeUndefined();
    expect(clean.metadata?.createdAt).toBeString();
  });

  test("refuses an empty message", () => {
    expect(() =>
      sanitizeUserMessage({ id: "u", role: "user", parts: [] }),
    ).toThrow(AgentMergeError);
  });
});

describe("applyClientDecisions", () => {
  test("records approvals and page-tool outputs, ignores the rest", () => {
    const merged = applyClientDecisions(stored, {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "tampered" },
        {
          type: "dynamic-tool",
          toolName: "denizlg24__web_notes",
          toolCallId: "call_1",
          state: "approval-responded",
          input: { action: "delete", id: "SOMETHING_ELSE" },
          approval: { id: "appr_1", approved: false, reason: "keep it" },
        },
        {
          type: "tool-navigate_desktop",
          toolCallId: "call_2",
          state: "output-available",
          input: { path: "/dashboard/x" },
          output: { navigated: true },
        },
      ],
    });
    const last = merged.at(-1);
    expect(last?.parts[0]).toEqual({ type: "text", text: "Deleting it." });
    expect(last?.parts[1]).toMatchObject({
      state: "approval-responded",
      input: { action: "delete", id: "n1" },
      approval: { id: "appr_1", approved: false, reason: "keep it" },
    });
    expect(last?.parts[2]).toMatchObject({
      state: "output-available",
      input: { path: "/dashboard/notes" },
      output: { navigated: true },
    });
    expect(hasPendingWork(merged)).toBe(false);
  });

  test("refuses a decision for a message the thread is not waiting on", () => {
    expect(() =>
      applyClientDecisions(stored, {
        id: "other",
        role: "assistant",
        parts: [],
      }),
    ).toThrow(AgentMergeError);
  });

  test("refuses an approval with a mismatched approval id", () => {
    expect(() =>
      applyClientDecisions(stored, {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "denizlg24__web_notes",
            toolCallId: "call_1",
            state: "approval-responded",
            input: {},
            approval: { id: "forged", approved: true },
          },
        ],
      }),
    ).toThrow("Nothing to continue from");
  });

  test("resumes when a page-tool result was stored before the model retry", () => {
    const completed = applyClientDecisions(stored, {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-navigate_desktop",
          toolCallId: "call_2",
          state: "output-available",
          input: { path: "/dashboard/notes" },
          output: { ok: true },
        },
      ],
    });

    expect(() =>
      applyClientDecisions(completed, completed.at(-1)!),
    ).not.toThrow();
  });

  test("does not resume an old tool result after a later step completed", () => {
    const completed = applyClientDecisions(stored, {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-navigate_desktop",
          toolCallId: "call_2",
          state: "output-available",
          input: { path: "/dashboard/notes" },
          output: { ok: true },
        },
      ],
    });
    const finished: AgentUIMessage[] = [
      ...completed.slice(0, -1),
      {
        ...completed.at(-1)!,
        parts: [
          ...completed.at(-1)!.parts,
          { type: "step-start" },
          { type: "text", text: "Opened notes.", state: "done" },
        ],
      },
    ];

    expect(() => applyClientDecisions(finished, completed.at(-1)!)).toThrow(
      "Nothing to continue from",
    );
  });
});

describe("hasPendingWork / truncateForRegenerate", () => {
  test("a waiting assistant message blocks a new user message", () => {
    expect(hasPendingWork(stored)).toBe(true);
    expect(hasPendingWork(stored.slice(0, 1))).toBe(false);
  });

  test("regenerate drops the assistant message and everything after it", () => {
    const history = truncateForRegenerate(
      [...stored, { id: "u3", role: "user", parts: [] }],
      "a1",
    );
    expect(history.map((message) => message.id)).toEqual(["u1"]);
    expect(() => truncateForRegenerate(stored, "u1")).toThrow(AgentMergeError);
  });
});
