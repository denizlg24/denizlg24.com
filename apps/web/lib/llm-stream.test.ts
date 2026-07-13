import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Characterization of the basic text SSE stream (used by /api/admin/llm and
// the note-enhance route): delta events, a done event with usage, error
// propagation, and the token-count preflight. Mocked at the network layer.

process.env.AI_GATEWAY_API_KEY ??= "test-gateway-key";

const llmUsageCreateMock = mock(
  async (_entry: Record<string, unknown>) => ({}),
);
mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
mock.module("@/models/LlmUsage", () => ({
  LlmUsage: { create: llmUsageCreateMock },
}));

const catalogModels = [
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    owned_by: "anthropic",
    type: "language",
    tags: ["tool-use"],
    context_window: 1000000,
    max_tokens: 64000,
    pricing: { input: "0.000003", output: "0.000015" },
  },
];

function sse(events: { event: string; data: object }[]): Response {
  const body = events
    .map(
      ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`,
    )
    .join("\n");
  return new Response(`${body}\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function messageStreamResponse(chunks: string[]): Response {
  return sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "anthropic/claude-sonnet-4.5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 0 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    },
    ...chunks.map((text) => ({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
    })),
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 7 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ]);
}

let countTokensRequests: Record<string, unknown>[] = [];
let streamRequests: Record<string, unknown>[] = [];
let nextStreamResponse: () => Response = () =>
  messageStreamResponse(["Hel", "lo"]);

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/v1/models")) {
    return new Response(
      JSON.stringify({ object: "list", data: catalogModels }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  const rawBody =
    input instanceof Request ? await input.text() : String(init?.body ?? "");
  const body = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  if (url.includes("/count_tokens")) {
    countTokensRequests.push(body);
    return new Response(JSON.stringify({ input_tokens: 12 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/messages")) {
    streamRequests.push(body);
    return nextStreamResponse();
  }
  throw new Error(`Unexpected fetch in llm-stream tests: ${url}`);
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

const { __resetCatalogForTests } = await import("./llm-model-catalog");
const { streamText } = await import("./llm-service");

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

beforeEach(() => {
  __resetCatalogForTests();
  countTokensRequests = [];
  streamRequests = [];
  nextStreamResponse = () => messageStreamResponse(["Hel", "lo"]);
  llmUsageCreateMock.mockClear();
});

describe("streamText", () => {
  test("emits delta events then a done event with usage", async () => {
    const events = await collectEvents(
      await streamText({
        purpose: "llm-api",
        source: "llm-test",
        model: "anthropic/claude-sonnet-4.5",
        system: "sys",
        prompt: "hello",
      }),
    );

    expect(events.map((e) => e.type)).toEqual(["delta", "delta", "done"]);
    expect(events[0].text).toBe("Hel");
    expect(events[1].text).toBe("lo");
    const usage = events[2].usage as Record<string, unknown>;
    expect(usage.inputTokens).toBe(12);
    expect(usage.outputTokens).toBe(7);
    expect(usage.model).toBe("anthropic/claude-sonnet-4.5");
    expect(typeof usage.costUsd).toBe("number");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      llmModel: "anthropic/claude-sonnet-4.5",
      source: "llm-test",
      inputTokens: 12,
      outputTokens: 7,
    });
  });

  test("bounds max_tokens by the preflight token count and model limits", async () => {
    await collectEvents(
      await streamText({
        purpose: "llm-api",
        source: "llm-test",
        model: "claude-sonnet-4-5",
        system: "sys",
        prompt: "hello",
      }),
    );

    // Legacy alias resolved before the upstream calls.
    expect(countTokensRequests[0]?.model).toBe("anthropic/claude-sonnet-4.5");
    // min(maxOutput 64000, context 1M - 12 input) = 64000
    expect(streamRequests[0]?.max_tokens).toBe(64000);
  });

  test("emits an error event when the upstream stream fails", async () => {
    nextStreamResponse = () =>
      new Response(JSON.stringify({ error: { message: "upstream boom" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    const events = await collectEvents(
      await streamText({
        purpose: "llm-api",
        source: "llm-test",
        model: "anthropic/claude-sonnet-4.5",
        system: "sys",
        prompt: "hello",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });
});
