import { expect, test } from "bun:test";
import { playSpeechSource, type SpeechSink } from "./react";

class FakeOutput implements SpeechSink<string> {
  scheduled: string[] = [];
  private finishers: Array<() => void> = [];

  decode(blob: Blob): Promise<string> {
    return blob.text();
  }

  schedule(clip: string): Promise<void> {
    this.scheduled.push(clip);
    return new Promise((resolve) => this.finishers.push(resolve));
  }

  finishNext() {
    this.finishers.shift()?.();
  }

  stop() {
    for (const finish of this.finishers.splice(0)) finish();
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const reading = Array.from(
  { length: 120 },
  (_, index) => `Sentence ${index} has a handful of words in it.`,
).join(" ");

test("requests run ahead of playback, bounded, and play in order", async () => {
  const output = new FakeOutput();
  const requested: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const pending: Array<() => void> = [];
  const generate = async (text: string) => {
    requested.push(text);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => pending.push(resolve));
    inFlight -= 1;
    return { blob: new Blob([text]) };
  };

  const done = playSpeechSource(
    reading,
    generate,
    new AbortController().signal,
    undefined,
    output,
  );
  await tick();
  expect(requested.length).toBe(3);

  while (pending.length > 0 || output.scheduled.length < requested.length) {
    pending.shift()?.();
    await tick();
    output.finishNext();
    await tick();
  }
  await done;

  expect(peak).toBeLessThanOrEqual(3);
  expect(output.scheduled).toEqual(requested);
  expect(output.scheduled.join(" ")).toBe(reading);
});

test("stopping ends playback without requesting the rest", async () => {
  const output = new FakeOutput();
  const requested: string[] = [];
  const abort = new AbortController();
  const done = playSpeechSource(
    reading,
    async (text) => {
      requested.push(text);
      return { blob: new Blob([text]) };
    },
    abort.signal,
    undefined,
    output,
  );
  await tick();
  await tick();
  abort.abort();
  await done;
  expect(requested.length).toBeLessThan(6);
});
