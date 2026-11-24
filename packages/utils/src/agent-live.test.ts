import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import {
  applyLivePatch,
  createPatchGate,
  createSseParser,
  diffMessageParts,
  INTERRUPTED_TOOL_TEXT,
  interruptMessage,
  upsertMessage,
} from "./agent-live";

const user: AgentUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hi" }],
};

function reply(...texts: string[]): AgentUIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: texts.map((text) => ({ type: "text", text, state: "streaming" })),
  };
}

describe("diffMessageParts", () => {
  test("a new reader gets the whole message", () => {
    expect(diffMessageParts(null, reply("a", "b"))).toEqual({
      start: 0,
      parts: reply("a", "b").parts,
    });
  });

  test("only the parts from the first change on", () => {
    expect(diffMessageParts(reply("a", "b"), reply("a", "bc", "d"))).toEqual({
      start: 1,
      parts: reply("bc", "d").parts,
    });
  });

  test("nothing when nothing changed", () => {
    expect(diffMessageParts(reply("a"), reply("a"))).toBeNull();
  });

  test("a metadata change alone still produces a patch", () => {
    const next = { ...reply("a"), metadata: { model: "m" } };
    expect(diffMessageParts(reply("a"), next)).toEqual({ start: 1, parts: [] });
  });
});

describe("applyLivePatch", () => {
  test("appends a reply the client does not hold yet", () => {
    const messages = applyLivePatch([user], {
      messageId: "a1",
      start: 0,
      parts: reply("Hel").parts,
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts).toEqual(reply("Hel").parts);
  });

  test("never draws a tail without its head", () => {
    expect(
      applyLivePatch([user], {
        messageId: "a1",
        start: 2,
        parts: reply("x").parts,
      }),
    ).toEqual([user]);
  });

  test("replaying a patch does not duplicate text", () => {
    const patch = { messageId: "a1", start: 0, parts: reply("Hello").parts };
    const once = applyLivePatch([user, reply("He")], patch);
    const twice = applyLivePatch(once, patch);
    expect(twice).toEqual(once);
    expect(twice[1]?.parts).toEqual(reply("Hello").parts);
  });

  test("a full snapshot over a longer stale copy wins", () => {
    const stale = reply("Hello", "wor");
    const messages = applyLivePatch([user, stale], {
      messageId: "a1",
      start: 0,
      parts: reply("Hello").parts,
    });
    expect(messages[1]?.parts).toEqual(reply("Hello").parts);
  });

  test("continues an existing assistant message in place", () => {
    const messages = applyLivePatch([user, reply("a", "b")], {
      messageId: "a1",
      start: 1,
      parts: reply("b!", "c").parts,
      metadata: { finishReason: "stop" },
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts).toEqual(reply("a", "b!", "c").parts);
    expect(messages[1]?.metadata?.finishReason).toBe("stop");
  });
});

describe("createPatchGate", () => {
  test("drops patches at or below the last applied seq of a turn", () => {
    const gate = createPatchGate();
    expect(gate.accept({ turnId: "t1", seq: 3 })).toBe(true);
    expect(gate.accept({ turnId: "t1", seq: 3 })).toBe(false);
    expect(gate.accept({ turnId: "t1", seq: 2 })).toBe(false);
    expect(gate.accept({ turnId: "t1", seq: 4 })).toBe(true);
  });

  test("a new turn starts its own sequence", () => {
    const gate = createPatchGate();
    gate.accept({ turnId: "t1", seq: 9 });
    expect(gate.accept({ turnId: "t2", seq: 1 })).toBe(true);
  });
});

describe("interruptMessage", () => {
  test("settles streaming text and fails unfinished tool calls", () => {
    const message: AgentUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Looking", state: "streaming" },
        {
          type: "dynamic-tool",
          toolName: "x__y",
          toolCallId: "c1",
          state: "input-available",
          input: { q: 1 },
        },
        {
          type: "tool-ask_user",
          toolCallId: "c2",
          state: "input-streaming",
          input: undefined,
        },
        {
          type: "dynamic-tool",
          toolName: "x__z",
          toolCallId: "c3",
          state: "output-available",
          input: {},
          output: 1,
        },
      ],
    };
    const settled = interruptMessage(message);
    expect(settled.metadata?.interrupted).toBe(true);
    expect(settled.parts[0]).toMatchObject({ state: "done" });
    expect(settled.parts[1]).toMatchObject({
      state: "output-error",
      errorText: INTERRUPTED_TOOL_TEXT,
      input: { q: 1 },
    });
    expect(settled.parts[2]).toMatchObject({ state: "output-error" });
    expect(settled.parts[3]).toEqual(message.parts[3] as never);
  });

  test("leaves a call waiting on approval alone", () => {
    const message: AgentUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "x__y",
          toolCallId: "c1",
          state: "approval-requested",
          input: {},
          approval: { id: "ap1" },
        },
      ],
    };
    expect(interruptMessage(message).parts).toEqual(message.parts);
  });
});

describe("upsertMessage", () => {
  test("replaces by id or appends", () => {
    expect(upsertMessage([user, reply("a")], reply("b"))).toEqual([
      user,
      reply("b"),
    ]);
    expect(upsertMessage([user], reply("b"))).toEqual([user, reply("b")]);
  });
});

describe("createSseParser", () => {
  test("joins events split across chunks and skips comments", () => {
    const seen: string[] = [];
    const parse = createSseParser((data) => seen.push(data));
    parse(': ping\n\ndata: {"a"');
    parse(":1}\n");
    parse("\ndata: two\r\n\r\n");
    expect(seen).toEqual(['{"a":1}', "two"]);
  });
});
