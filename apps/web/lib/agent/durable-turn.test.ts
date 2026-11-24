import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import type { UIMessageChunk } from "ai";
import { beginDurableTurn, type DurableTurnStore } from "./durable-turn";
import { getLiveTurn, subscribeLiveTurn } from "./live-turns";

function controllable() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  const stream = new ReadableStream<UIMessageChunk>({
    start(value) {
      controller = value;
    },
  });
  return { stream, controller };
}

function fakeStore(
  overrides: Partial<{ cancel: boolean; lost: boolean }> = {},
) {
  const writes: { seq: number; message: AgentUIMessage }[] = [];
  let finalized = 0;
  const state = {
    cancel: overrides.cancel ?? false,
    lost: overrides.lost ?? false,
  };
  const store: DurableTurnStore = {
    heartbeat: async (snapshot) => {
      if (snapshot) writes.push(snapshot);
      return { cancelRequested: state.cancel, lost: state.lost };
    },
    finalize: async () => {
      finalized += 1;
    },
  };
  return {
    store,
    writes,
    state,
    finalized: () => finalized,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function drain(stream: ReadableStream<UIMessageChunk>) {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

describe("beginDurableTurn", () => {
  test("runs to the end with nobody reading the response", async () => {
    const fake = fakeStore();
    const turn = beginDurableTurn({
      conversationId: "c-orphan",
      turnId: "t1",
      store: fake.store,
      heartbeatMs: 10,
    });
    const { stream, controller } = controllable();
    const response = turn.attach(stream);
    // The client went away before the first token.
    void response.cancel();
    controller.enqueue({ type: "start", messageId: "a1" });
    controller.enqueue({ type: "text-start", id: "x" });
    controller.enqueue({ type: "text-delta", id: "x", delta: "Hello" });
    await sleep(30);
    controller.enqueue({ type: "text-end", id: "x" });
    controller.enqueue({ type: "finish" });
    controller.close();
    expect(await turn.done).toBe("finished");
    expect(fake.finalized()).toBe(1);
    expect(fake.writes.at(-1)?.message.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: "Hello" }),
    );
    expect(getLiveTurn("c-orphan")).toBeNull();
  });

  test("a stop flagged on the row aborts the turn's signal", async () => {
    const fake = fakeStore();
    const turn = beginDurableTurn({
      conversationId: "c-stop",
      turnId: "t2",
      store: fake.store,
      heartbeatMs: 5,
    });
    const { stream, controller } = controllable();
    const response = turn.attach(stream);
    void drain(response);
    turn.signal.addEventListener("abort", () => {
      controller.enqueue({ type: "abort" });
      controller.close();
    });
    controller.enqueue({ type: "start", messageId: "a1" });
    fake.state.cancel = true;
    expect(await turn.done).toBe("aborted");
    expect(turn.signal.aborted).toBe(true);
    expect(fake.finalized()).toBe(1);
  });

  test("a lost lease stops the turn and reports it", async () => {
    const fake = fakeStore({ lost: true });
    const turn = beginDurableTurn({
      conversationId: "c-lost",
      turnId: "t3",
      store: fake.store,
      heartbeatMs: 5,
    });
    const { stream, controller } = controllable();
    turn.signal.addEventListener("abort", () => controller.close());
    void drain(turn.attach(stream));
    expect(await turn.done).toBe("lost");
  });

  test("readers in the same process hear snapshots and the end", async () => {
    const fake = fakeStore();
    const turn = beginDurableTurn({
      conversationId: "c-live",
      turnId: "t4",
      store: fake.store,
      heartbeatMs: 1_000,
    });
    const seen: string[] = [];
    const subscription = subscribeLiveTurn("c-live", (event) => {
      seen.push(
        event.kind === "end"
          ? `end:${event.status}`
          : `seq:${event.snapshot.seq > 0}`,
      );
    });
    expect(subscription?.turn.turnId).toBe("t4");
    const { stream, controller } = controllable();
    void drain(turn.attach(stream));
    controller.enqueue({ type: "start", messageId: "a1" });
    controller.enqueue({ type: "text-start", id: "x" });
    controller.enqueue({ type: "text-delta", id: "x", delta: "Hi" });
    await sleep(80);
    controller.enqueue({ type: "finish" });
    controller.close();
    await turn.done;
    expect(seen).toContain("seq:true");
    expect(seen.at(-1)).toBe("end:finished");
  });

  test("continues the base message when resuming a stored turn", async () => {
    const fake = fakeStore();
    const turn = beginDurableTurn({
      conversationId: "c-continue",
      turnId: "t5",
      store: fake.store,
      heartbeatMs: 5,
    });
    const base: AgentUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "Before.", state: "done" }],
    };
    const { stream, controller } = controllable();
    void drain(turn.attach(stream, base));
    controller.enqueue({ type: "start", messageId: "a1" });
    controller.enqueue({ type: "text-start", id: "y" });
    controller.enqueue({ type: "text-delta", id: "y", delta: "After." });
    controller.enqueue({ type: "text-end", id: "y" });
    await sleep(20);
    controller.enqueue({ type: "finish" });
    controller.close();
    await turn.done;
    const texts = fake.writes
      .at(-1)
      ?.message.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      );
    expect(texts).toEqual(["Before.", "After."]);
  });

  test("a turn that never streamed releases the thread", async () => {
    const fake = fakeStore();
    const turn = beginDurableTurn({
      conversationId: "c-fail",
      turnId: "t6",
      store: fake.store,
    });
    await turn.fail();
    expect(await turn.done).toBe("finished");
    expect(fake.finalized()).toBe(1);
    expect(getLiveTurn("c-fail")).toBeNull();
  });
});
