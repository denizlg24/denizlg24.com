import { describe, expect, test } from "bun:test";
import {
  applyChunk,
  createEventParser,
  emptyTurn,
  fullText,
  spokenText,
  type TurnState,
} from "./stream";

function run(chunks: unknown[]): TurnState {
  return chunks.reduce<TurnState>(applyChunk, emptyTurn);
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
  test("speaks only what follows the last tool call", () => {
    const state = run([
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", delta: "Let me check." },
      { type: "text-end", id: "1" },
      {
        type: "tool-input-start",
        toolCallId: "t",
        toolName: "web_calendar_events",
      },
      { type: "tool-output-available", toolCallId: "t", output: {} },
      { type: "text-start", id: "2" },
      { type: "text-delta", id: "2", delta: "You have " },
      { type: "text-delta", id: "2", delta: "two meetings." },
      { type: "finish" },
    ]);
    expect(spokenText(state)).toBe("You have two meetings.");
    expect(fullText(state)).toBe("Let me check.\n\nYou have two meetings.");
    expect(state.finished).toBe(true);
  });

  test("names the running tool until its output lands", () => {
    const running = run([
      { type: "tool-input-start", toolCallId: "t", toolName: "save_memory" },
    ]);
    expect(running.runningTool).not.toBeNull();
    expect(
      applyChunk(running, { type: "tool-output-available", toolCallId: "t" })
        .runningTool,
    ).toBeNull();
  });

  test("carries the stream's error", () => {
    expect(run([{ type: "error", errorText: "Rate limit" }]).error).toBe(
      "Rate limit",
    );
  });
});
