import { describe, expect, mock, test } from "bun:test";

// Characterization tests for the basic text SSE stream used by
// /api/admin/llm and the note-enhance route.

process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

const llmUsageCreateMock = mock(
  async (_entry: Record<string, unknown>) => ({}),
);
mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
mock.module("@/models/LlmUsage", () => ({
  LlmUsage: { create: llmUsageCreateMock },
}));

const { createSSEStream } = await import("./llm");
type StreamResult = import("./llm").StreamResult;

interface FakeTextStream {
  on(event: "text", cb: (delta: string) => void): void;
  finalMessage(): Promise<unknown>;
  abort(): void;
  aborted: boolean;
}

function fakeTextStream(chunks: string[]): FakeTextStream {
  let textCb: ((delta: string) => void) | undefined;
  return {
    aborted: false,
    on(event, cb) {
      if (event === "text") textCb = cb;
    },
    async finalMessage() {
      for (const chunk of chunks) textCb?.(chunk);
      return {
        usage: {
          input_tokens: 12,
          output_tokens: 7,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
    },
    abort() {
      this.aborted = true;
    },
  };
}

function buildResult(stream: FakeTextStream): StreamResult {
  return {
    stream: stream as unknown as StreamResult["stream"],
    model: "test-model",
    system: "sys",
    prompt: "hello",
    source: "llm-test",
    inputTokens: 12,
  };
}

async function collectEvents(
  stream: ReadableStream,
): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
  }
  const events: Record<string, unknown>[] = [];
  for (const line of buffer.split("\n")) {
    if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
  }
  return events;
}

describe("createSSEStream", () => {
  test("emits delta events then a done event with usage", async () => {
    llmUsageCreateMock.mockClear();
    const events = await collectEvents(
      createSSEStream(buildResult(fakeTextStream(["Hel", "lo"]))),
    );

    expect(events.map((e) => e.type)).toEqual(["delta", "delta", "done"]);
    expect(events[0].text).toBe("Hel");
    expect(events[1].text).toBe("lo");
    const usage = events[2].usage as Record<string, unknown>;
    expect(usage.inputTokens).toBe(12);
    expect(usage.outputTokens).toBe(7);
    expect(usage.model).toBe("test-model");
    expect(typeof usage.costUsd).toBe("number");

    // Usage logging is fire-and-forget; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llmUsageCreateMock).toHaveBeenCalledTimes(1);
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      llmModel: "test-model",
      source: "llm-test",
      inputTokens: 12,
      outputTokens: 7,
    });
  });

  test("emits an error event when the upstream stream fails", async () => {
    const failing = fakeTextStream([]);
    failing.finalMessage = async () => {
      throw new Error("upstream boom");
    };
    const events = await collectEvents(createSSEStream(buildResult(failing)));
    expect(events).toEqual([{ type: "error", error: "upstream boom" }]);
  });

  test("cancel aborts the upstream stream", async () => {
    let release: (() => void) | undefined;
    const hanging = fakeTextStream([]);
    hanging.finalMessage = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error("aborted");
    };
    const stream = createSSEStream(buildResult(hanging));
    const reader = stream.getReader();
    await reader.cancel();
    expect(hanging.aborted).toBe(true);
    release?.();
  });
});
