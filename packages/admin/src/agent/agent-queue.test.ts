import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import {
  type DispatchGate,
  mergeServerQueue,
  nextQueuedMessage,
  type QueuedMessage,
  queuedText,
  shouldQueueMessage,
} from "./agent-queue";

function message(id: string, text = id): AgentUIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

const idle: DispatchGate = {
  turnActive: false,
  awaitingClient: false,
  paused: false,
  backgroundRun: false,
  failed: false,
};

describe("mergeServerQueue", () => {
  test("server order first, local in-flight entries after", () => {
    const local: QueuedMessage[] = [
      { message: message("a"), state: "queued" },
      { message: message("c"), state: "sending" },
      { message: message("d"), state: "failed" },
    ];
    const merged = mergeServerQueue(local, [message("b"), message("a")]);
    expect(merged.map((entry) => [entry.message.id, entry.state])).toEqual([
      ["b", "queued"],
      ["a", "queued"],
      ["c", "sending"],
      ["d", "failed"],
    ]);
  });

  test("a stale server copy of a dispatched head is not queued again", () => {
    const merged = mergeServerQueue(
      [],
      [message("x"), message("y")],
      new Set(["x"]),
    );
    expect(merged.map((entry) => entry.message.id)).toEqual(["y"]);
  });

  test("an entry the server confirmed is not listed twice", () => {
    const merged = mergeServerQueue(
      [{ message: message("a"), state: "sending" }],
      [message("a")],
    );
    expect(merged).toEqual([{ message: message("a"), state: "queued" }]);
  });

  test("a queued entry the server no longer holds is gone", () => {
    expect(
      mergeServerQueue([{ message: message("a"), state: "queued" }], []),
    ).toEqual([]);
  });
});

describe("nextQueuedMessage", () => {
  const queue: QueuedMessage[] = [
    { message: message("a"), state: "queued" },
    { message: message("b"), state: "queued" },
  ];

  test("the head goes once the thread is free", () => {
    expect(nextQueuedMessage(queue, idle)?.message.id).toBe("a");
  });

  test("nothing goes while anything holds the thread", () => {
    for (const key of Object.keys(idle) as (keyof DispatchGate)[]) {
      expect(nextQueuedMessage(queue, { ...idle, [key]: true })).toBeNull();
    }
  });

  test("a head still on its way to the server holds the rest back", () => {
    expect(
      nextQueuedMessage(
        [{ message: message("a"), state: "sending" }, ...queue.slice(1)],
        idle,
      ),
    ).toBeNull();
  });
});

describe("shouldQueueMessage", () => {
  test("queues behind a turn, an open question, or older queued messages", () => {
    const base = { turnActive: false, awaitingClient: false, queued: 0 };
    expect(shouldQueueMessage(base)).toBe(false);
    expect(shouldQueueMessage({ ...base, turnActive: true })).toBe(true);
    expect(shouldQueueMessage({ ...base, awaitingClient: true })).toBe(true);
    expect(shouldQueueMessage({ ...base, queued: 1 })).toBe(true);
  });
});

test("queuedText falls back to the attachment count", () => {
  expect(queuedText(message("a", " hello "))).toBe("hello");
  expect(
    queuedText({
      id: "f",
      role: "user",
      parts: [{ type: "file", mediaType: "image/png", url: "https://x/y" }],
    }),
  ).toBe("1 attachment");
});
