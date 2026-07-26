import { describe, expect, it } from "bun:test";

import {
  type ActivityEntryInput,
  ActivityRecorder,
  type ActivitySink,
} from "./activity";

function entry(action: string): ActivityEntryInput {
  return { category: "system", action };
}

function collectingSink(): {
  sink: ActivitySink;
  batches: readonly ActivityEntryInput[][];
} {
  const batches: ActivityEntryInput[][] = [];
  return {
    batches,
    sink: async (rows) => {
      batches.push([...rows]);
    },
  };
}

describe("ActivityRecorder", () => {
  it("buffers until flushed", async () => {
    const { sink, batches } = collectingSink();
    const recorder = new ActivityRecorder({ sink, flushThreshold: 100 });

    recorder.record(entry("a"));
    recorder.record(entry("b"));
    expect(batches).toHaveLength(0);
    expect(recorder.pending).toBe(2);

    await recorder.flush();

    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((row) => row.action)).toEqual(["a", "b"]);
    expect(recorder.pending).toBe(0);
  });

  it("flushes automatically once the threshold is reached", async () => {
    const { sink, batches } = collectingSink();
    const recorder = new ActivityRecorder({ sink, flushThreshold: 3 });

    recorder.record(entry("a"));
    recorder.record(entry("b"));
    expect(batches).toHaveLength(0);
    recorder.record(entry("c"));
    await recorder.flush();

    expect(batches.flat()).toHaveLength(3);
  });

  it("drops the oldest entries rather than growing without bound", async () => {
    const { sink, batches } = collectingSink();
    const recorder = new ActivityRecorder({
      sink,
      flushThreshold: 1_000,
      maxBuffered: 3,
    });

    for (const action of ["a", "b", "c", "d", "e"]) {
      recorder.record(entry(action));
    }
    await recorder.flush();

    expect(batches.flat().map((row) => row.action)).toEqual(["c", "d", "e"]);
  });

  it("swallows sink failures so a request is never broken by logging", async () => {
    let calls = 0;
    const recorder = new ActivityRecorder({
      sink: async () => {
        calls += 1;
        throw new Error("postgres is down");
      },
      flushThreshold: 1_000,
    });

    recorder.record(entry("a"));
    await recorder.flush();

    expect(calls).toBe(1);
    // Not requeued: a poison row would retry forever behind a growing buffer.
    expect(recorder.pending).toBe(0);
  });

  it("does not run two flushes concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const recorder = new ActivityRecorder({
      sink: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
      },
      flushThreshold: 1_000,
    });

    recorder.record(entry("a"));
    recorder.record(entry("b"));
    await Promise.all([recorder.flush(), recorder.flush(), recorder.flush()]);

    expect(maxInFlight).toBe(1);
  });

  it("drains the buffer on stop", async () => {
    const { sink, batches } = collectingSink();
    const recorder = new ActivityRecorder({ sink, flushThreshold: 1_000 });
    recorder.start();

    recorder.record(entry("a"));
    await recorder.stop();

    expect(batches.flat()).toHaveLength(1);
  });
});
