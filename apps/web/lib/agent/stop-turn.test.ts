import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import type { IConversationActiveTurn } from "@/models/Conversation";

mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));

let row: IConversationActiveTurn | null = null;
const real = await import("./turn-store");
mock.module("@/lib/agent/turn-store", () => ({
  ...real,
  requestTurnCancel: async () => {
    if (!row) return null;
    row = { ...row, cancelRequestedAt: new Date() };
    return row.id;
  },
  readActiveTurn: async () => row,
}));

const { stopConversationTurn } = await import("./stop-turn");
const { registerLiveTurn, endLiveTurn } = await import("./live-turns");
const { activeTurnView, isTurnLive, withTurnMessage } = real;

const reply: AgentUIMessage = {
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "partial", state: "streaming" }],
};

beforeEach(() => {
  row = null;
});

describe("stopConversationTurn", () => {
  test("nothing running", async () => {
    expect(await stopConversationTurn("c0")).toEqual({
      stopped: false,
      turnId: null,
    });
  });

  test("aborts a turn in this process and waits for it to release", async () => {
    const now = new Date();
    row = { id: "t1", startedAt: now, heartbeatAt: now, seq: 1 };
    const controller = new AbortController();
    registerLiveTurn({ conversationId: "c1", turnId: "t1", controller });
    controller.signal.addEventListener("abort", () => {
      setTimeout(() => {
        row = null;
        endLiveTurn("c1", "t1", "aborted");
      }, 20);
    });
    const result = await stopConversationTurn("c1", { pollMs: 5 });
    expect(controller.signal.aborted).toBe(true);
    expect(result).toEqual({ stopped: true, turnId: "t1" });
  });

  test("flags a turn on another replica and waits for the row to clear", async () => {
    const now = new Date();
    row = { id: "t2", startedAt: now, heartbeatAt: now, seq: 1 };
    setTimeout(() => {
      row = null;
    }, 30);
    const result = await stopConversationTurn("c2", { pollMs: 5 });
    expect(result).toEqual({ stopped: true, turnId: "t2" });
  });

  test("reports a turn that did not stop in time", async () => {
    const now = new Date();
    row = { id: "t3", startedAt: now, heartbeatAt: now, seq: 1 };
    const result = await stopConversationTurn("c3", { waitMs: 20, pollMs: 5 });
    expect(result).toEqual({ stopped: false, turnId: "t3" });
    expect(row?.cancelRequestedAt).toBeInstanceOf(Date);
  });
});

describe("turn-store views", () => {
  test("a live turn's partial reply is merged by id, a dead one is not live", () => {
    const now = new Date();
    const turn: IConversationActiveTurn = {
      id: "t1",
      startedAt: now,
      heartbeatAt: now,
      seq: 5,
      message: reply,
    };
    expect(isTurnLive(turn)).toBe(true);
    expect(activeTurnView(turn)).toMatchObject({
      id: "t1",
      seq: 5,
      messageId: "a1",
    });
    const user: AgentUIMessage = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    };
    expect(withTurnMessage([user], turn)).toEqual([user, reply]);
    expect(withTurnMessage([user, reply], turn)).toEqual([user, reply]);

    const stale = new Date(Date.now() - 60 * 60_000);
    expect(isTurnLive({ ...turn, heartbeatAt: stale })).toBe(false);
    expect(activeTurnView({ ...turn, heartbeatAt: stale })).toBeNull();
  });
});
