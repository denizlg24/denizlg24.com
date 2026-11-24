import { describe, expect, mock, test } from "bun:test";
import type { AgentLiveEvent, AgentUIMessage } from "@repo/schemas";
import { applyLivePatch, createPatchGate } from "@repo/utils/agent-live";
import type { IConversationActiveTurn } from "@/models/Conversation";
import {
  endLiveTurn,
  getLiveTurn,
  publishSnapshot,
  registerLiveTurn,
} from "./live-turns";

mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
const { followTurnEvents } = await import("./turn-follow");

async function readEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<AgentLiveEvent[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)) as AgentLiveEvent);
}

function reply(text: string, extra: string[] = []): AgentUIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [text, ...extra].map((value) => ({
      type: "text" as const,
      text: value,
      state: "streaming" as const,
    })),
  };
}

/** What a client holding `start` ends up with after the events. */
function replay(
  start: AgentUIMessage[],
  events: AgentLiveEvent[],
): AgentUIMessage[] {
  const gate = createPatchGate();
  let messages = start;
  for (const event of events) {
    if (event.type === "patch" && gate.accept(event)) {
      messages = applyLivePatch(messages, event);
    }
  }
  return messages;
}

const user: AgentUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hi" }],
};

describe("followTurnEvents", () => {
  test("in-process: whole snapshot first, then diffs, then the end", async () => {
    const live = registerLiveTurn({
      conversationId: "c-follow",
      turnId: "t1",
      controller: new AbortController(),
    });
    publishSnapshot("c-follow", "t1", { seq: 1, message: reply("He") });
    const stream = followTurnEvents({
      conversationId: "c-follow",
      readTurn: async () => null,
    });
    const reading = readEvents(stream);
    publishSnapshot("c-follow", "t1", { seq: 2, message: reply("Hello") });
    publishSnapshot("c-follow", "t1", {
      seq: 3,
      message: reply("Hello", ["world"]),
    });
    endLiveTurn("c-follow", "t1", "finished");
    await live.done;
    const events = await reading;
    expect(events[0]).toMatchObject({ type: "patch", seq: 1, start: 0 });
    expect(events[1]).toMatchObject({ type: "patch", seq: 2, start: 0 });
    expect(events[2]).toMatchObject({ type: "patch", seq: 3, start: 1 });
    expect(events.at(-1)).toEqual({
      type: "end",
      turnId: "t1",
      status: "finished",
    });
    // A client that already held a partial copy lands on one reply, once.
    const messages = replay([user, reply("He")], events);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(reply("Hello", ["world"]));
  });

  test("another replica: polls the row until the turn releases it", async () => {
    const now = new Date();
    const rows: (IConversationActiveTurn | null)[] = [
      {
        id: "t9",
        startedAt: now,
        heartbeatAt: now,
        seq: 4,
        message: reply("Hel"),
      },
      {
        id: "t9",
        startedAt: now,
        heartbeatAt: now,
        seq: 4,
        message: reply("Hel"),
      },
      {
        id: "t9",
        startedAt: now,
        heartbeatAt: now,
        seq: 7,
        message: reply("Hello"),
      },
      null,
    ];
    const stream = followTurnEvents({
      conversationId: "c-remote",
      pollMs: 1,
      readTurn: async () => rows.shift() ?? null,
    });
    const events = await readEvents(stream);
    // The unchanged second read sends nothing.
    expect(events.map((event) => event.type)).toEqual([
      "patch",
      "patch",
      "end",
    ]);
    expect(events.at(-1)).toMatchObject({ turnId: "t9", status: "finished" });
    expect(replay([user], events)[1]).toEqual(reply("Hello"));
  });

  test("a row whose heartbeat lapsed ends as lost", async () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    const stream = followTurnEvents({
      conversationId: "c-stale",
      readTurn: async () => ({
        id: "t1",
        startedAt: stale,
        heartbeatAt: stale,
        seq: 1,
      }),
    });
    const events = await readEvents(stream);
    expect(events).toEqual([{ type: "end", turnId: "", status: "lost" }]);
  });

  test("a new turn on the row ends the followed one", async () => {
    const now = new Date();
    const rows: IConversationActiveTurn[] = [
      { id: "t1", startedAt: now, heartbeatAt: now, seq: 1 },
      { id: "t2", startedAt: now, heartbeatAt: now, seq: 1 },
    ];
    const events = await readEvents(
      followTurnEvents({
        conversationId: "c-next",
        pollMs: 1,
        readTurn: async () => rows.shift() ?? null,
      }),
    );
    expect(events).toEqual([{ type: "end", turnId: "t1", status: "finished" }]);
  });
});

describe("live turn registry", () => {
  test("a turn replaced by a newer one still ends for its own readers", async () => {
    const old = registerLiveTurn({
      conversationId: "c-replace",
      turnId: "old",
      controller: new AbortController(),
    });
    const newer = registerLiveTurn({
      conversationId: "c-replace",
      turnId: "new",
      controller: new AbortController(),
    });
    endLiveTurn("c-replace", "old", "finished");
    expect(await old.done).toBe("finished");
    expect(getLiveTurn("c-replace")?.turnId).toBe("new");
    endLiveTurn("c-replace", "new", "finished");
    expect(await newer.done).toBe("finished");
    expect(getLiveTurn("c-replace")).toBeNull();
  });
});
