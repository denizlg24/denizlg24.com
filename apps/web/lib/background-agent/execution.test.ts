import { describe, expect, test } from "bun:test";
import { consumeAgentStream } from "./consume-stream";

function openFrameStream(frame: string) {
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${frame}\n\n`));
    },
    cancel() {
      cancellations += 1;
    },
  });
  return { stream, cancellationCount: () => cancellations };
}

describe("background agent stream consumption", () => {
  test.each([
    ['{"type":"error","error":"upstream failed"}', "upstream failed"],
    ['{"type":"paused"}', "paused unexpectedly"],
    ["not-json", "JSON"],
  ])("cancels the reader before propagating %s", async (frame, message) => {
    const source = openFrameStream(frame);

    await expect(consumeAgentStream(source.stream)).rejects.toThrow(message);
    expect(source.cancellationCount()).toBe(1);
  });
});
