import { describe, expect, it } from "bun:test";

import { createSerialQueue, SerialQueueDrainingError } from "./concurrency";

describe("createSerialQueue", () => {
  it("runs one task at a time, in arrival order", async () => {
    const serial = createSerialQueue();
    const events: string[] = [];
    let active = 0;
    let peak = 0;
    const task = (name: string, ms: number) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end ${name}`);
      active -= 1;
      return name;
    };

    const results = await Promise.all([
      serial(task("a", 5)),
      serial(task("b", 1)),
      serial(task("c", 1)),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(peak).toBe(1);
    expect(events).toEqual([
      "start a",
      "end a",
      "start b",
      "end b",
      "start c",
      "end c",
    ]);
  });

  it("keeps going after a task rejects", async () => {
    const serial = createSerialQueue();
    const failed = serial(async () => {
      throw new Error("push timed out");
    });
    const next = serial(async () => "published");

    await expect(failed).rejects.toThrow("push timed out");
    expect(await next).toBe("published");
  });

  it("drains accepted work, refuses new work, and reopens on release", async () => {
    const serial = createSerialQueue();
    let finish = () => {};
    const running = serial(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve("pushed");
        }),
    );
    const queued = serial(async () => "queued");

    const draining = serial.drain(1_000);
    await expect(serial(async () => "late")).rejects.toBeInstanceOf(
      SerialQueueDrainingError,
    );
    finish();
    const release = await draining;

    expect(release).not.toBeNull();
    expect(await running).toBe("pushed");
    expect(await queued).toBe("queued");
    await expect(serial(async () => "late")).rejects.toBeInstanceOf(
      SerialQueueDrainingError,
    );
    release?.();
    expect(await serial(async () => "after")).toBe("after");
  });

  it("gives up on a drain that runs out of time and stays open", async () => {
    const serial = createSerialQueue();
    void serial(() => new Promise<void>(() => {}));

    expect(await serial.drain(5)).toBeNull();
    const accepted = serial(async () => "accepted");
    expect(await Promise.race([accepted, Promise.resolve("waiting")])).toBe(
      "waiting",
    );
  });
});
