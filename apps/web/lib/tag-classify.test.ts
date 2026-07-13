import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Characterization tests for the project/topic classifier. Its contract:
// JSON-object chat completion, temperature 0, and graceful fallback to
// "Other" on any failure (saves must never break). Mocked at the network
// layer so the tests survive transport changes.

process.env.AI_GATEWAY_API_KEY ??= "test-gateway-key";

const llmUsageCreateMock = mock(
  async (_entry: Record<string, unknown>) => ({}),
);
mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
mock.module("@/models/LlmUsage", () => ({
  LlmUsage: { create: llmUsageCreateMock },
}));

let recordedBodies: Record<string, unknown>[] = [];
let nextResponse: () => Response;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("/chat/completions")) {
    throw new Error(`Unexpected fetch in tag-classify tests: ${url}`);
  }
  const rawBody =
    input instanceof Request ? await input.text() : String(init?.body ?? "");
  recordedBodies.push(JSON.parse(rawBody) as Record<string, unknown>);
  return nextResponse();
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

function completionResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 21, completion_tokens: 8 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const { computeProjectTopicGroups, FALLBACK_GROUP } = await import(
  "./tag-classify"
);

const input = {
  title: "Home lab dashboard",
  subtitle: "Self-hosted monitoring",
  tags: ["nextjs", "raspberry-pi"],
  markdown: "A dashboard for my home lab.",
};

beforeEach(() => {
  recordedBodies = [];
  nextResponse = () => completionResponse('{"groups":["Infrastructure"]}');
  llmUsageCreateMock.mockClear();
});

describe("computeProjectTopicGroups", () => {
  test("returns coerced groups from a JSON object response", async () => {
    nextResponse = () =>
      completionResponse('{"groups":["Fullstack","Infrastructure"]}');
    const groups = await computeProjectTopicGroups(input);
    expect(groups).toEqual(["Fullstack", "Infrastructure"]);

    const body = recordedBodies[0];
    expect(body?.temperature).toBe(0);
    expect(body?.response_format).toEqual({ type: "json_object" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      source: "project-topic-classify",
      inputTokens: 21,
      outputTokens: 8,
    });
  });

  test("drops unknown groups and falls back when none remain", async () => {
    nextResponse = () => completionResponse('{"groups":["Blockchain"]}');
    expect(await computeProjectTopicGroups(input)).toEqual([FALLBACK_GROUP]);
  });

  test("falls back gracefully on a non-2xx response", async () => {
    nextResponse = () => new Response("nope", { status: 500 });
    expect(await computeProjectTopicGroups(input)).toEqual([FALLBACK_GROUP]);
  });

  test("falls back gracefully on malformed content", async () => {
    nextResponse = () => completionResponse("not json at all");
    expect(await computeProjectTopicGroups(input)).toEqual([FALLBACK_GROUP]);
  });

  test("falls back gracefully when the response has no content", async () => {
    nextResponse = () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    expect(await computeProjectTopicGroups(input)).toEqual([FALLBACK_GROUP]);
  });
});
