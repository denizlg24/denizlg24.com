import { describe, expect, test } from "bun:test";

// Live Gateway contract tests. Opt-in: they run only with LLM_LIVE_TESTS=1
// and a real, scoped AI_GATEWAY_API_KEY (never enable in untrusted PR CI).
// Output mentions only purpose, model ids, and pass/fail — no credentials or
// personal prompt content.

const LIVE = process.env.LLM_LIVE_TESTS === "1";
const describeLive = LIVE ? describe : describe.skip;

const LIVE_TIMEOUT_MS = 60_000;

describeLive("gateway live contracts", () => {
  test(
    "model discovery returns a valid catalog with capability tags",
    async () => {
      const { listModels } = await import("./llm-model-catalog");
      const { models, stale } = await listModels();
      expect(stale).toBe(false);
      expect(models.length).toBeGreaterThan(10);
      const anthropic = models.filter((m) => m.creator === "anthropic");
      expect(anthropic.length).toBeGreaterThan(0);
      expect(
        anthropic.some(
          (m) => m.tags.includes("tool-use") && m.tags.includes("web-search"),
        ),
      ).toBe(true);
      console.info(`[live] discovery: ${models.length} language models`);
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "token counting works through the gateway",
    async () => {
      const { countTokens } = await import("./llm-service");
      const count = await countTokens({
        purpose: "llm-api",
        model: "anthropic/claude-haiku-4.5",
        system: "You are a test.",
        prompt: "Count these tokens.",
      });
      expect(count).toBeGreaterThan(0);
      console.info(`[live] countTokens: ${count} tokens`);
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "plain text streaming emits deltas and a done event",
    async () => {
      const { streamText } = await import("./llm-service");
      const stream = await streamText({
        purpose: "llm-api",
        source: "llm-live-test",
        model: "anthropic/claude-haiku-4.5",
        system: "Reply with a single short word.",
        prompt: "Say ok.",
      });
      const events = await collectSse(stream);
      expect(events.some((e) => e.type === "delta")).toBe(true);
      expect(events.at(-1)?.type).toBe("done");
      console.info("[live] streamText: ok");
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "forced tool call returns validated tool input",
    async () => {
      const { generateToolResult } = await import("./llm-service");
      const { input } = await generateToolResult({
        purpose: "triage-classify",
        source: "llm-live-test",
        model: "anthropic/claude-haiku-4.5",
        system: "Classify the sentiment of the user message.",
        prompt: "This is wonderful!",
        maxTokens: 100,
        temperature: 0,
        tool: {
          name: "report_sentiment",
          description: "Report the sentiment of the message.",
          input_schema: {
            type: "object",
            properties: {
              sentiment: { type: "string", enum: ["positive", "negative"] },
            },
            required: ["sentiment"],
            additionalProperties: false,
          },
        },
      });
      expect(input?.sentiment).toBe("positive");
      console.info("[live] forced tool: ok");
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "streamed parallel tool calls arrive on a tool-use model",
    async () => {
      const { getGatewayAnthropicClient } = await import(
        "./llm-transports/anthropic-gateway"
      );
      const client = getGatewayAnthropicClient();
      const stream = client.messages.stream({
        model: "anthropic/claude-haiku-4.5",
        max_tokens: 500,
        system:
          "You have two independent lookup tools. Call both tools in the same turn.",
        tools: [
          {
            name: "lookup_a",
            description: "Look up value A.",
            input_schema: { type: "object", properties: {} },
          },
          {
            name: "lookup_b",
            description: "Look up value B.",
            input_schema: { type: "object", properties: {} },
          },
        ],
        messages: [
          { role: "user", content: "Fetch value A and value B for me." },
        ],
      });
      const message = await stream.finalMessage();
      const toolUses = message.content.filter(
        (block) => block.type === "tool_use",
      );
      expect(message.stop_reason).toBe("tool_use");
      expect(toolUses.length).toBeGreaterThanOrEqual(2);
      console.info(`[live] parallel tools: ${toolUses.length} tool_use blocks`);
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "web search works on a web-search model",
    async () => {
      const { getGatewayAnthropicClient } = await import(
        "./llm-transports/anthropic-gateway"
      );
      const client = getGatewayAnthropicClient();
      const message = await client.messages.create({
        model: "anthropic/claude-haiku-4.5",
        max_tokens: 1000,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 1 },
        ],
        messages: [
          {
            role: "user",
            content: "Search the web for today's date and state it briefly.",
          },
        ],
      });
      expect(
        message.content.some(
          (block) =>
            block.type === "server_tool_use" ||
            block.type === "web_search_tool_result",
        ),
      ).toBe(true);
      console.info("[live] web search: ok");
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "the configured semantic model honors JSON-object responses",
    async () => {
      const { generateJson, getSemanticModel } = await import("./llm-service");
      const result = await generateJson<{ answer: string }>({
        purpose: "semantic",
        source: "llm-live-test",
        system: 'Return JSON only: {"answer": "yes"}.',
        user: "Respond now.",
        temperature: 0,
      });
      expect(result.json?.answer).toBe("yes");
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      console.info(`[live] json (${getSemanticModel()}): ok`);
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "capability validation rejects before any generation call",
    async () => {
      const { listModels, resolveModel } = await import("./llm-service");
      const { LlmModelError } = await import("./llm-errors");
      // Find a live language model without tool-use and require it.
      const { models } = await listModels();
      const noTools = models.find((m) => !m.tags.includes("tool-use"));
      if (!noTools) {
        console.info("[live] capability rejection: no candidate model");
        return;
      }
      expect(
        resolveModel({ model: noTools.id, purpose: "triage-classify" }),
      ).rejects.toBeInstanceOf(LlmModelError);
      console.info(`[live] capability rejection (${noTools.id}): ok`);
    },
    LIVE_TIMEOUT_MS,
  );
});

async function collectSse(
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
