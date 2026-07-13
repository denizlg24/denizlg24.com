import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Service facade behavior: legacy alias resolution, capability validation
// before generation, configurable defaults, lazy credential checks, usage
// attribution, and cost estimation from catalog pricing.

process.env.AI_GATEWAY_API_KEY ??= "test-gateway-key";
// The service's agent-loop dependency pulls the tools registry, whose module
// graph asserts unrelated credentials at import time.
process.env.RESEND_API_KEY ??= "test-resend-key";
// Exercise the built-in unattended-job default rather than a local override.
delete process.env.SEMANTIC_LLM_MODEL;

const llmUsageCreateMock = mock(
  async (_entry: Record<string, unknown>) => ({}),
);
mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
mock.module("@/models/LlmUsage", () => ({
  LlmUsage: { create: llmUsageCreateMock },
}));

const catalogModels = [
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    owned_by: "anthropic",
    type: "language",
    tags: ["tool-use", "web-search", "explicit-caching"],
    context_window: 200000,
    max_tokens: 64000,
    pricing: {
      input: "0.000001",
      output: "0.000005",
      input_cache_read: "0.0000001",
      input_cache_write: "0.00000125",
    },
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    owned_by: "anthropic",
    type: "language",
    tags: ["tool-use", "web-search", "reasoning"],
    context_window: 1000000,
    max_tokens: 128000,
    pricing: { input: "0.000003", output: "0.000015" },
  },
  {
    id: "mistral/plain-model",
    name: "Plain Model",
    owned_by: "mistral",
    type: "language",
    tags: [],
    pricing: {},
  },
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    owned_by: "deepseek",
    type: "language",
    tags: ["tool-use"],
    pricing: { input: "0.00000027", output: "0.0000011" },
  },
  {
    id: "openai/gpt-image-1",
    name: "GPT Image 1",
    owned_by: "openai",
    type: "image",
    tags: [],
    pricing: {},
  },
  {
    id: "openai/text-embedding-3-small",
    name: "Text Embedding 3 Small",
    owned_by: "openai",
    type: "embedding",
    tags: [],
    pricing: { input: "0.00000002" },
  },
];

interface RecordedRequest {
  url: string;
  body: Record<string, unknown>;
}

let recordedRequests: RecordedRequest[] = [];
let catalogAvailable = true;
let nextMessageContent: () => unknown[] = () => [
  { type: "text", text: "hello" },
];
let nextCompletion: () => Response = () => completionResponse('{"ok":true}');

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function completionResponse(content: string): Response {
  return jsonResponse({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/v1/models")) {
    if (!catalogAvailable) throw new Error("catalog offline");
    return jsonResponse({ object: "list", data: catalogModels });
  }
  const rawBody =
    input instanceof Request ? await input.text() : String(init?.body ?? "");
  const body = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  recordedRequests.push({ url, body });

  if (url.includes("/count_tokens")) {
    return jsonResponse({ input_tokens: 321 });
  }
  if (url.includes("/chat/completions")) {
    return nextCompletion();
  }
  if (url.includes("/embeddings")) {
    const dimensions = Number(body.dimensions);
    return jsonResponse({
      data: [{ embedding: Array.from({ length: dimensions }, () => 0.25) }],
      usage: { prompt_tokens: 12, total_tokens: 12 },
    });
  }
  if (url.includes("/messages")) {
    return jsonResponse({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "end_turn",
      content: nextMessageContent(),
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
  }
  throw new Error(`Unexpected fetch in service tests: ${url}`);
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

const { __resetCatalogForTests } = await import("./llm-model-catalog");
const {
  countTokens,
  embedText,
  estimateCost,
  generateJson,
  generateText,
  generateToolResult,
  getSemanticModel,
  listModels,
  resolveLegacyAlias,
  resolveEmbeddingModel,
  resolveModel,
  streamAgent,
} = await import("./llm-service");
const { LlmConfigurationError, LlmModelError, LlmTransportError } =
  await import("./llm-errors");

beforeEach(() => {
  __resetCatalogForTests();
  recordedRequests = [];
  catalogAvailable = true;
  nextMessageContent = () => [{ type: "text", text: "hello" }];
  nextCompletion = () => completionResponse('{"ok":true}');
  llmUsageCreateMock.mockClear();
});

describe("resolveModel", () => {
  test("maps legacy aliases to fully qualified Gateway ids", async () => {
    expect(resolveLegacyAlias("claude-haiku-4-5-20251001")).toBe(
      "anthropic/claude-haiku-4.5",
    );
    expect(resolveLegacyAlias("deepseek-chat")).toBe("deepseek/deepseek-v3.2");

    const resolved = await resolveModel({
      model: "claude-sonnet-4-6",
      purpose: "chat",
    });
    expect(resolved.id).toBe("anthropic/claude-sonnet-4.6");
    expect(resolved.catalogModel?.name).toBe("Claude Sonnet 4.6");
  });

  test("rejects unqualified unknown model names", async () => {
    expect(
      resolveModel({ model: "some-mystery-model", purpose: "chat" }),
    ).rejects.toBeInstanceOf(LlmModelError);
  });

  test("rejects models missing from the catalog", async () => {
    expect(
      resolveModel({ model: "anthropic/claude-nope", purpose: "chat" }),
    ).rejects.toBeInstanceOf(LlmModelError);
  });

  test("rejects non-language models", async () => {
    expect(
      resolveModel({ model: "openai/gpt-image-1", purpose: "chat" }),
    ).rejects.toBeInstanceOf(LlmModelError);
  });

  test("enforces purpose capability profiles", async () => {
    // Triage purposes force tool-use; the plain model lacks it.
    expect(
      resolveModel({
        model: "mistral/plain-model",
        purpose: "triage-classify",
      }),
    ).rejects.toBeInstanceOf(LlmModelError);

    const ok = await resolveModel({
      model: "mistral/plain-model",
      purpose: "note-categorize",
    });
    expect(ok.id).toBe("mistral/plain-model");
  });

  test("passes through a fully qualified id when the catalog is cold", async () => {
    catalogAvailable = false;
    const resolved = await resolveModel({
      model: "anthropic/claude-haiku-4.5",
      purpose: "chat",
    });
    expect(resolved.id).toBe("anthropic/claude-haiku-4.5");
    expect(resolved.catalogModel).toBeNull();

    // A bare alias still resolves through the map on a cold catalog.
    const aliased = await resolveModel({
      model: "claude-haiku-4-5",
      purpose: "chat",
    });
    expect(aliased.id).toBe("anthropic/claude-haiku-4.5");
  });
});

describe("credentials", () => {
  test("generation requires AI_GATEWAY_API_KEY; discovery does not", async () => {
    const saved = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    try {
      const { models } = await listModels();
      expect(models.length).toBeGreaterThan(0);

      expect(
        generateText({
          purpose: "note-categorize",
          source: "test",
          model: "anthropic/claude-haiku-4.5",
          system: "s",
          prompt: "p",
        }),
      ).rejects.toBeInstanceOf(LlmConfigurationError);
    } finally {
      process.env.AI_GATEWAY_API_KEY = saved;
    }
  });
});

describe("embedText", () => {
  test("resolves an embedding model, validates dimensions, and redacts logs", async () => {
    const result = await embedText({
      purpose: "agent-memory-embedding",
      source: "agent-memory-query-embedding",
      model: "openai/text-embedding-3-small",
      dimensions: 1_536,
      value: "private memory text",
    });
    expect(result.vector).toHaveLength(1_536);
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.costUsd).toBeCloseTo(0.00000024, 12);
    expect(recordedRequests.at(-1)?.body).toMatchObject({
      model: "openai/text-embedding-3-small",
      dimensions: 1_536,
      input: "private memory text",
    });
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      userPrompt: "[agent-memory embedding input redacted]",
      source: "agent-memory-query-embedding",
    });
  });

  test("rejects language models for embedding", async () => {
    expect(
      resolveEmbeddingModel("anthropic/claude-haiku-4.5"),
    ).rejects.toBeInstanceOf(LlmModelError);
  });
});

describe("generateText", () => {
  test("sends the resolved model, returns text, and logs usage", async () => {
    const result = await generateText({
      purpose: "note-categorize",
      source: "note-categorize",
      model: "claude-haiku-4-5-20251001",
      system: "private memory context",
      logSystemPrompt: "redacted system prompt",
      prompt: "prompt",
      maxTokens: 4096,
    });

    expect(result.text).toBe("hello");
    expect(result.usage.inputTokens).toBe(1000);
    expect(result.usage.outputTokens).toBe(200);
    // 1000 * 0.000001 + 200 * 0.000005 = 0.002
    expect(result.usage.costUsd).toBeCloseTo(0.002, 9);

    const request = recordedRequests.at(-1);
    expect(request?.url).toContain("ai-gateway.vercel.sh");
    expect(request?.body.model).toBe("anthropic/claude-haiku-4.5");
    expect(request?.body.max_tokens).toBe(4096);
    expect(request?.body.system).toBe("private memory context");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      llmModel: "anthropic/claude-haiku-4.5",
      source: "note-categorize",
      costUsd: result.usage.costUsd,
      systemPrompt: "redacted system prompt",
    });
  });
});

describe("generateToolResult", () => {
  const tool = {
    name: "classify_email",
    description: "d",
    input_schema: { type: "object" as const, properties: {} },
  };

  test("forces the tool and returns its input", async () => {
    nextMessageContent = () => [
      {
        type: "tool_use",
        id: "tu_1",
        name: "classify_email",
        input: { category: "fyi" },
      },
    ];
    const result = await generateToolResult({
      purpose: "triage-classify",
      source: "email-triage-classify",
      model: "claude-sonnet-4-6",
      system: "sys",
      prompt: "full prompt text",
      tool,
      maxTokens: 220,
      temperature: 0,
      logUserPrompt: "truncated",
    });

    expect(result.input).toEqual({ category: "fyi" });
    const request = recordedRequests.at(-1);
    expect(request?.body.tool_choice).toEqual({
      type: "tool",
      name: "classify_email",
      disable_parallel_tool_use: true,
    });
    expect(request?.body.temperature).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      userPrompt: "truncated",
      source: "email-triage-classify",
    });
  });

  test("returns undefined input when the model skips the tool", async () => {
    nextMessageContent = () => [{ type: "text", text: "no tool" }];
    const result = await generateToolResult({
      purpose: "triage-classify",
      source: "email-triage-classify",
      model: "claude-sonnet-4-6",
      system: "sys",
      prompt: "p",
      tool,
      maxTokens: 220,
    });
    expect(result.input).toBeUndefined();
  });

  test("rejects a model without tool-use before any generation call", async () => {
    expect(
      generateToolResult({
        purpose: "triage-classify",
        source: "email-triage-classify",
        model: "mistral/plain-model",
        system: "sys",
        prompt: "p",
        tool,
        maxTokens: 220,
      }),
    ).rejects.toBeInstanceOf(LlmModelError);
    expect(recordedRequests).toHaveLength(0);
  });
});

describe("generateJson", () => {
  test("defaults to the configured semantic model and parses JSON", async () => {
    expect(getSemanticModel()).toBe("deepseek/deepseek-v3.2");
    nextCompletion = () => completionResponse('{"keywords":["a"]}');

    const result = await generateJson<{ keywords: string[] }>({
      purpose: "semantic",
      source: "semantic-keyword-llm",
      system: "sys",
      user: "user",
      logUserPrompt: "[redacted]",
      temperature: 0.2,
    });

    expect(result.json).toEqual({ keywords: ["a"] });
    const request = recordedRequests.at(-1);
    expect(request?.url).toContain("/chat/completions");
    expect(request?.body.model).toBe("deepseek/deepseek-v3.2");
    expect(request?.body.response_format).toEqual({ type: "json_object" });
    expect(request?.body.temperature).toBe(0.2);
    expect(llmUsageCreateMock.mock.calls[0]?.[0]).toMatchObject({
      llmModel: "deepseek/deepseek-v3.2",
      inputTokens: 100,
      outputTokens: 50,
      userPrompt: "[redacted]",
    });
  });

  test("retries without JSON mode when the model rejects response_format", async () => {
    let attempt = 0;
    nextCompletion = () => {
      attempt += 1;
      return attempt === 1
        ? jsonResponse(
            {
              error: {
                message: "Invalid input",
                param: "response_format",
              },
            },
            { status: 400 },
          )
        : completionResponse('{"keywords":["fallback"]}');
    };

    const result = await generateJson<{ keywords: string[] }>({
      purpose: "semantic",
      source: "semantic-keyword-llm",
      system: "Return JSON.",
      user: "user",
    });

    expect(result.json).toEqual({ keywords: ["fallback"] });
    expect(recordedRequests).toHaveLength(2);
    expect(recordedRequests[0]?.body.response_format).toEqual({
      type: "json_object",
    });
    expect(recordedRequests[1]?.body.response_format).toBeUndefined();
  });

  test("resolves json null for unparseable content", async () => {
    nextCompletion = () => completionResponse("not json");
    const result = await generateJson({
      purpose: "topic-classify",
      source: "tag-topic-classify",
      system: "sys",
      user: "user",
    });
    expect(result.json).toBeNull();
    expect(result.content).toBe("not json");
  });

  test("throws a transport error on non-2xx responses", async () => {
    nextCompletion = () => new Response("bad", { status: 500 });
    expect(
      generateJson({
        purpose: "semantic",
        source: "semantic-keyword-llm",
        system: "sys",
        user: "user",
      }),
    ).rejects.toBeInstanceOf(LlmTransportError);
  });

  test("throws a transport error when content is missing", async () => {
    nextCompletion = () => jsonResponse({ choices: [] });
    expect(
      generateJson({
        purpose: "semantic",
        source: "semantic-keyword-llm",
        system: "sys",
        user: "user",
      }),
    ).rejects.toBeInstanceOf(LlmTransportError);
  });
});

describe("countTokens", () => {
  test("returns the upstream token count for the resolved model", async () => {
    const count = await countTokens({
      model: "claude-haiku-4-5",
      purpose: "llm-api",
      system: "sys",
      prompt: "p",
    });
    expect(count).toBe(321);
    expect(recordedRequests.at(-1)?.body.model).toBe(
      "anthropic/claude-haiku-4.5",
    );
  });
});

describe("streamAgent", () => {
  test("rejects an incompatible model before opening a stream", async () => {
    expect(
      streamAgent({
        purpose: "chat",
        source: "dashboard-chat",
        model: "mistral/plain-model",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        requireTools: true,
      }),
    ).rejects.toBeInstanceOf(LlmModelError);
    expect(recordedRequests).toHaveLength(0);
  });

  test("rejects web search on a model without the web-search tag", async () => {
    expect(
      streamAgent({
        purpose: "chat",
        source: "dashboard-chat",
        model: "deepseek/deepseek-v3.2",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        requireWebSearch: true,
      }),
    ).rejects.toBeInstanceOf(LlmModelError);
  });
});

describe("estimateCost", () => {
  const catalogModel = {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    creator: "anthropic",
    type: "language",
    tags: [],
    pricing: {
      input: 0.000001,
      output: 0.000005,
      cacheRead: 0.0000001,
      cacheWrite: 0.00000125,
      hasTiers: false,
    },
  };

  test("prices input, output, and cache traffic from catalog rates", () => {
    const cost = estimateCost({
      catalogModel,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheUsage: {
        cacheCreationInputTokens: 200_000,
        cacheReadInputTokens: 400_000,
      },
    });
    // 1 + 0.5 + 0.25 + 0.04
    expect(cost).toBeCloseTo(1.79, 6);
  });

  test("returns 0 (not a generic default) for unknown pricing", () => {
    expect(
      estimateCost({
        catalogModel: null,
        inputTokens: 5000,
        outputTokens: 100,
      }),
    ).toBe(0);
  });
});
