import { describe, expect, test } from "bun:test";
import {
  type AgentTurn,
  applyChunk,
  approvalReply,
  createEventParser,
  emptyTurn,
  messageText,
  pendingApprovals,
  replyText,
  runningTool,
} from "./agent-stream";

function run(chunks: unknown[]): AgentTurn {
  return chunks.reduce<AgentTurn>(applyChunk, emptyTurn());
}

describe("createEventParser", () => {
  test("reassembles events split across reads and drops [DONE]", () => {
    const parse = createEventParser();
    expect(parse('data: {"type":"start"}\n\ndata: {"type":"text-')).toEqual([
      { type: "start" },
    ]);
    expect(parse('start","id":"a"}\n\ndata: [DONE]\n\n')).toEqual([
      { type: "text-start", id: "a" },
    ]);
  });
});

describe("turn reduction", () => {
  test("the reply is what follows the last tool call", () => {
    const turn = run([
      { type: "start", messageId: "m1" },
      { type: "start-step" },
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", delta: "Let me check." },
      { type: "text-end", id: "1" },
      {
        type: "tool-input-start",
        toolCallId: "t",
        toolName: "web_calendar_events",
      },
      { type: "tool-output-available", toolCallId: "t", output: {} },
      { type: "start-step" },
      { type: "text-start", id: "2" },
      { type: "text-delta", id: "2", delta: "You have " },
      { type: "text-delta", id: "2", delta: "two meetings." },
      { type: "finish" },
    ]);
    expect(turn.message.id).toBe("m1");
    expect(replyText(turn.message)).toBe("You have two meetings.");
    expect(messageText(turn.message)).toBe(
      "Let me check.\n\nYou have two meetings.",
    );
    expect(turn.finished).toBe(true);
  });

  test("names the running tool until its output lands", () => {
    const running = run([
      { type: "tool-input-start", toolCallId: "t", toolName: "save_memory" },
    ]);
    expect(runningTool(running.message)).not.toBeNull();
    const done = applyChunk(running, {
      type: "tool-output-available",
      toolCallId: "t",
      output: null,
    });
    expect(runningTool(done.message)).toBeNull();
  });

  test("carries the stream's error", () => {
    expect(run([{ type: "error", errorText: "Rate limit" }]).error).toBe(
      "Rate limit",
    );
  });

  test("an approval request is pending until answered, and only it is replied", () => {
    const turn = run([
      { type: "start", messageId: "m2" },
      { type: "start-step" },
      {
        type: "tool-input-available",
        toolCallId: "send",
        toolName: "denizlg24__web_emails",
        dynamic: true,
        input: { action: "send" },
      },
      {
        type: "tool-approval-request",
        toolCallId: "send",
        approvalId: "a1",
      },
      {
        type: "tool-input-available",
        toolCallId: "read",
        toolName: "denizlg24__web_notes",
        dynamic: true,
        input: { action: "list" },
      },
      { type: "tool-output-available", toolCallId: "read", output: [] },
      { type: "finish" },
    ]);
    const pending = pendingApprovals(turn.message);
    expect(pending.map((part) => part.approval.id)).toEqual(["a1"]);

    const reply = approvalReply(turn.message, new Map([["a1", false]]));
    expect(reply.id).toBe("m2");
    expect(reply.parts).toHaveLength(1);
    expect(reply.parts[0]).toMatchObject({
      type: "dynamic-tool",
      toolCallId: "send",
      state: "approval-responded",
      approval: { id: "a1", approved: false },
    });
  });

  test("a denied call stops asking", () => {
    const turn = run([
      {
        type: "tool-input-available",
        toolCallId: "x",
        toolName: "web_markets_orders",
        input: {},
      },
      { type: "tool-approval-request", toolCallId: "x", approvalId: "a" },
      { type: "tool-output-denied", toolCallId: "x" },
    ]);
    expect(pendingApprovals(turn.message)).toEqual([]);
    expect(turn.message.parts[0]).toMatchObject({
      type: "tool-web_markets_orders",
      state: "output-denied",
    });
  });
});
