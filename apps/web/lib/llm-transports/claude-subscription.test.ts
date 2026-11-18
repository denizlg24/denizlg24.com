import { describe, expect, test } from "bun:test";
import { access, stat } from "node:fs/promises";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { toUIMessageStream } from "ai";
import { z } from "zod";
import {
  type ClaudeSubscriptionTurnInput,
  claudeModelId,
  claudeModelsFromRuntime,
  createClaudeSubscriptionAdapter,
} from "./claude-subscription";

const input = (): ClaudeSubscriptionTurnInput => ({
  token: "synthetic-secret-setup-token",
  model: "anthropic/claude-sonnet-4-6",
  instructions: "Help with the dashboard.",
  messages: [{ role: "user", content: "Hello" }],
  tools: {},
});
// Fixtures deliberately contain only the SDK fields consumed by the adapter.
const sdk = (message: unknown) => message as SDKMessage;
const event = (value: unknown) => sdk({ type: "stream_event", event: value });
const result = (extra: Record<string, unknown> = {}) =>
  sdk({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Hello",
    usage: {
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5,
    },
    modelUsage: { "claude-sonnet-4-6": { contextWindow: 200000 } },
    ...extra,
  });
const textEvents = () => [
  event({
    type: "message_start",
    message: {
      usage: {
        input_tokens: 10,
        output_tokens: 0,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
      },
    },
  }),
  event({
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "" },
  }),
  event({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "Thinking" },
  }),
  event({ type: "content_block_stop", index: 0 }),
  event({
    type: "content_block_start",
    index: 1,
    content_block: { type: "text", text: "Hel" },
  }),
  event({
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: "lo" },
  }),
  event({ type: "content_block_stop", index: 1 }),
  // Complete assistant messages duplicate partial events and must be ignored.
  sdk({
    type: "assistant",
    message: { content: [{ type: "text", text: "Hello" }] },
  }),
];

const toolEvents = (name = "mcp__dashboard__mutate") => [
  event({
    type: "message_start",
    message: {
      usage: {
        input_tokens: 10,
        output_tokens: 0,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
      },
    },
  }),
  event({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "call-1", name, input: {} },
  }),
  event({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"value":' },
  }),
  event({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '"hello"}' },
  }),
  event({ type: "content_block_stop", index: 0 }),
  event({
    type: "message_delta",
    delta: { stop_reason: "tool_use" },
    usage: { output_tokens: 7 },
  }),
  event({ type: "message_stop" }),
  // Must never advance to the SDK's autonomous follow-up.
  sdk({ type: "system", subtype: "model_refusal_fallback" }),
];

function fixture(
  messages: SDKMessage[] | SDKMessage[][],
  inspect?: (options: Options) => Promise<void>,
) {
  let options: Options | undefined;
  let prompt: string | undefined;
  let closed = 0;
  let calls = 0;
  const adapter = createClaudeSubscriptionAdapter(async () => ({
    query(params) {
      const step = calls++;
      options = params.options;
      prompt = params.prompt;
      return {
        async *[Symbol.asyncIterator]() {
          await inspect?.(params.options);
          yield* Array.isArray(messages[0])
            ? (messages as SDKMessage[][])[step]!
            : (messages as SDKMessage[]);
        },
        close() {
          closed++;
        },
      };
    },
  }));
  return {
    adapter,
    get options() {
      return options!;
    },
    get prompt() {
      return prompt!;
    },
    get calls() {
      return calls;
    },
    get closed() {
      return closed;
    },
  };
}

async function collect<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const chunks: T[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return chunks;
    chunks.push(next.value);
  }
}

describe("Claude subscription adapter (synthetic SDK; no paid calls)", () => {
  test("returns AgentTurn stream understood by the installed UI converter", async () => {
    const f = fixture([...textEvents(), result()]);
    const ends: unknown[] = [];
    const turn = await f.adapter({
      ...input(),
      onTurnEnd: (end) => {
        ends.push(end);
      },
    });
    const [normalized, uiSource] = turn.result.stream.tee();
    const [parts, ui] = await Promise.all([
      collect(normalized),
      collect(toUIMessageStream({ stream: uiSource })),
    ]);
    expect(
      ui
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => chunk.delta)
        .join(""),
    ).toBe("Hello");
    expect(ui.some((chunk) => chunk.type === "reasoning-delta")).toBe(true);
    expect(ui.at(-1)?.type).toBe("finish");
    expect(turn.modelId).toBe("claude-sonnet-4-6");
    expect(turn.contextWindow).toBe(200000);
    const finish = parts.find((part) => part.type === "finish");
    expect(finish).toBeDefined();
    expect(turn.describeUsage(finish!.totalUsage)).toEqual({
      inputTokens: 35,
      outputTokens: 4,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      reasoningTokens: 0,
      contextWindow: 200000,
      costUsd: 0,
    });
    expect(ends).toHaveLength(1);
    expect(f.closed).toBe(1);
    await expect(access(f.options.cwd!)).rejects.toThrow();
  });

  test("isolates child credentials, settings, and tool permissions", async () => {
    const before = { ...process.env };
    const f = fixture([result()]);
    await collect((await f.adapter(input())).result.stream);
    expect(process.env).toEqual(before);
    expect(f.options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(input().token);
    expect(f.options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(f.options.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(f.options.env?.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(f.options.env?.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(f.options.env?.HOME).toBe(f.options.cwd);
    expect(f.options.env?.CLAUDE_CONFIG_DIR).toBe(`${f.options.cwd}/config`);
    expect(f.options.tools).toEqual([]);
    expect(f.options.mcpServers).toEqual({});
    expect(f.options.strictMcpConfig).toBe(true);
    expect(f.options.settingSources).toEqual([]);
    expect(f.options.persistSession).toBe(false);
    expect(f.options.settings).toEqual({ disableAllHooks: true });
    expect(await f.options.canUseTool!("Bash", {}, {} as never)).toMatchObject({
      behavior: "deny",
    });
    expect(f.prompt).not.toContain(input().token);
  });

  test("rejects unsupported media without starting an SDK query", async () => {
    const f = fixture([]);
    const turn = await f.adapter({
      ...input(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: new Uint8Array([1]),
              mediaType: "image/png",
            },
          ],
        },
      ],
    });
    const chunks = await collect(turn.result.stream);
    expect(chunks.some((part) => part.type === "error")).toBe(true);
    expect(f.calls).toBe(0);
  });

  test("preserves text role history and provides result-only text fallback", async () => {
    const f = fixture([result()]);
    const turn = await f.adapter({
      ...input(),
      messages: [
        { role: "user", content: "Earlier" },
        { role: "assistant", content: [{ type: "text", text: "Reply" }] },
        { role: "user", content: "Next" },
      ],
    });
    const chunks = await collect(turn.result.stream);
    expect(
      chunks
        .filter((p) => p.type === "text-delta")
        .map((p) => p.text)
        .join(""),
    ).toBe("Hello");
    expect(JSON.parse(f.prompt.split("\n").at(-1)!)).toMatchObject([
      { role: "system", content: input().instructions },
      { role: "user", content: [{ type: "text", text: "Earlier" }] },
      { role: "assistant", content: [{ type: "text", text: "Reply" }] },
      { role: "user", content: [{ type: "text", text: "Next" }] },
    ]);
  });

  test("advertises exact app schemas, defers MCP execution, closes before outer execution, and resumes updated results", async () => {
    let executed = 0;
    let listed: unknown;
    let client: Client;
    let pending: Promise<unknown>;
    let inspections = 0;
    const schema = z.object({
      value: z.string().min(2),
      count: z.number().int().optional(),
    });
    const f = fixture(
      [toolEvents(), [...textEvents(), result()]],
      async (options) => {
        expect(options.tools).toEqual([]);
        expect(options.allowedTools).toEqual(["mcp__dashboard__mutate"]);
        expect(
          await options.canUseTool!("Read", {}, {} as never),
        ).toMatchObject({ behavior: "deny" });
        expect(
          await options.canUseTool!("mcp__other__mutate", {}, {} as never),
        ).toMatchObject({ behavior: "deny" });
        expect(
          await options.canUseTool!("mcp__dashboard__mutate", {}, {} as never),
        ).toMatchObject({ behavior: "allow" });
        if (inspections++ > 0) return;
        const config = options.mcpServers!.dashboard!;
        if (!("instance" in config)) throw Error("Expected in-process MCP");
        client = new Client({ name: "fixture", version: "1" });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await config.instance.connect(a);
        await client.connect(b);
        listed = (await client.listTools()).tools;
        pending = client
          .callTool({ name: "mutate", arguments: { value: "from MCP" } })
          .catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(executed).toBe(0);
      },
    );
    const turn = await f.adapter({
      ...input(),
      tools: {
        mutate: {
          description: "Mutate dashboard",
          inputSchema: schema,
          execute: async ({ value }) => {
            expect(f.closed).toBe(1);
            executed++;
            return { saved: value };
          },
        },
      },
      toolApproval: () => "approved",
    });
    const chunks = await collect(turn.result.stream);
    await pending!;
    await client!.close();
    expect(listed).toMatchObject([
      {
        name: "mutate",
        description: "Mutate dashboard",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string", minLength: 2 },
            count: { type: "integer" },
          },
          required: ["value"],
        },
      },
    ]);
    expect(executed).toBe(1);
    expect(f.calls).toBe(2);
    expect(f.closed).toBe(2);
    expect(chunks.find((part) => part.type === "tool-call")).toMatchObject({
      toolName: "mutate",
      toolCallId: "call-1",
      input: { value: "hello" },
    });
    expect(chunks.find((part) => part.type === "finish-step")).toMatchObject({
      finishReason: "tool-calls",
      usage: { inputTokens: 35, outputTokens: 7 },
    });
    expect(f.prompt).toContain('"tool-result"');
    expect(f.prompt).toContain('"saved":"hello"');
    expect(f.prompt).toContain('"toolCallId":"call-1"');
    expect(chunks.at(-1)).toMatchObject({
      type: "finish",
      finishReason: "stop",
    });
  });

  test("outer pending and denied approvals never execute app methods", async () => {
    for (const decision of ["user-approval", "denied"] as const) {
      let executed = 0;
      const f = fixture([toolEvents(), [...textEvents(), result()]]);
      const turn = await f.adapter({
        ...input(),
        tools: {
          mutate: {
            inputSchema: z.object({ value: z.string() }),
            execute: async () => {
              executed++;
              return "unexpected";
            },
          },
        },
        toolApproval: () => decision,
      });
      const chunks = await collect(turn.result.stream);
      expect(executed).toBe(0);
      if (decision === "user-approval") {
        expect(
          chunks.some((part) => part.type === "tool-approval-request"),
        ).toBe(true);
        expect(f.calls).toBe(1);
      } else {
        expect(chunks.some((part) => part.type === "tool-output-denied")).toBe(
          true,
        );
        expect(f.prompt).toContain("execution-denied");
      }
    }
  });

  test("approved UI response executes once outside SDK and replays its result", async () => {
    const first = fixture(toolEvents());
    let executed = 0;
    const tools = {
      mutate: {
        inputSchema: z.object({ value: z.string() }),
        execute: async () => {
          executed++;
          return "approved-result";
        },
      },
    };
    const initial = await first.adapter({
      ...input(),
      tools,
      toolApproval: () => "user-approval",
    });
    const initialChunks = await collect(initial.result.stream);
    const request = initialChunks.find(
      (part) => part.type === "tool-approval-request",
    );
    if (request?.type !== "tool-approval-request")
      throw Error("Missing approval request");
    expect(executed).toBe(0);
    const resumed = fixture([...textEvents(), result()]);
    const turn = await resumed.adapter({
      ...input(),
      tools,
      toolApproval: () => "user-approval",
      messages: [
        ...input().messages,
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "mutate",
              input: { value: "hello" },
            },
            {
              type: "tool-approval-request",
              approvalId: request.approvalId,
              toolCallId: "call-1",
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-approval-response",
              approvalId: request.approvalId,
              approved: true,
            },
          ],
        },
      ],
    });
    const chunks = await collect(turn.result.stream);
    expect(executed).toBe(1);
    expect(resumed.prompt).toContain("approved-result");
    expect(resumed.prompt).toContain('"tool-result"');
    expect(chunks.at(-1)).toMatchObject({
      type: "finish",
      finishReason: "stop",
    });
  });

  test("a denied UI approval response resumes with denial and never executes", async () => {
    let executed = 0;
    const f = fixture([...textEvents(), result()]);
    const turn = await f.adapter({
      ...input(),
      tools: {
        mutate: {
          inputSchema: z.object({ value: z.string() }),
          execute: async () => {
            executed++;
            return "unexpected";
          },
        },
      },
      messages: [
        ...input().messages,
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "mutate",
              input: { value: "hello" },
            },
            {
              type: "tool-approval-request",
              approvalId: "approval-1",
              toolCallId: "call-1",
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-approval-response",
              approvalId: "approval-1",
              approved: false,
              reason: "Do not change this",
            },
          ],
        },
      ],
    });
    await collect(turn.result.stream);
    expect(executed).toBe(0);
    expect(f.prompt).toContain("execution-denied");
    expect(f.prompt).toContain("Do not change this");
  });

  test("malformed JSON or a non-advertised SDK tool never reaches app execution", async () => {
    for (const messages of [
      toolEvents("Bash"),
      toolEvents().map((item) =>
        item.type === "stream_event" &&
        item.event.type === "content_block_delta"
          ? event({
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: "{" },
            })
          : item,
      ),
    ]) {
      let executed = 0;
      const f = fixture(messages);
      const turn = await f.adapter({
        ...input(),
        tools: {
          mutate: {
            inputSchema: z.object({ value: z.string() }),
            execute: async () => {
              executed++;
            },
          },
        },
      });
      const chunks = await collect(turn.result.stream);
      expect(executed).toBe(0);
      expect(chunks.some((part) => part.type === "error")).toBe(true);
      expect(f.closed).toBe(1);
    }
  });

  test("passes configured native executable to SDK without inheriting host environment", async () => {
    const previous = process.env.CLAUDE_CODE_EXECUTABLE;
    try {
      process.env.CLAUDE_CODE_EXECUTABLE = "/runtime/claude";
      const f = fixture([result()]);
      await collect((await f.adapter(input())).result.stream);
      expect(f.options.pathToClaudeCodeExecutable).toBe("/runtime/claude");
      expect(f.options.env?.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CODE_EXECUTABLE;
      else process.env.CLAUDE_CODE_EXECUTABLE = previous;
    }
  });

  test("preserves length stop reason", async () => {
    const f = fixture([
      ...textEvents(),
      event({
        type: "message_delta",
        delta: { stop_reason: "max_tokens" },
        usage: { input_tokens: null, output_tokens: 4 },
      }),
      result(),
    ]);
    const chunks = await collect((await f.adapter(input())).result.stream);
    expect(chunks.find((p) => p.type === "finish")).toMatchObject({
      finishReason: "length",
    });
  });

  test("reports SDK failure and premature EOF without leaking raw errors", async () => {
    for (const messages of [
      [],
      [result({ is_error: true, result: input().token })],
      [
        sdk({
          type: "result",
          subtype: "error_max_turns",
          errors: [input().token],
        }),
      ],
    ]) {
      const f = fixture(messages);
      const ends: unknown[] = [];
      const chunks = await collect(
        (
          await f.adapter({
            ...input(),
            onTurnEnd: (end) => {
              ends.push(end);
            },
          })
        ).result.stream,
      );
      const errors = chunks.filter((p) => p.type === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(String(errors[0]!.error)).not.toContain(input().token);
      expect(f.closed).toBe(1);
      expect(ends).toHaveLength(1);
      await expect(access(f.options.cwd!)).rejects.toThrow();
    }
  });

  test("rejects web search and fetch before starting a runtime", async () => {
    const f = fixture([]);
    for (const capability of ["webSearch", "webFetch"] as const) {
      await expect(
        f.adapter({ ...input(), [capability]: true }),
      ).rejects.toThrow("not supported");
    }
    expect(f.calls).toBe(0);
  });

  test("sanitizes thrown SDK errors and refuses unexpected tool calls or model fallback", async () => {
    const adapter = createClaudeSubscriptionAdapter(async () => ({
      query() {
        throw new Error(input().token);
      },
    }));
    const failures = [
      await adapter(input()),
      await fixture([
        event({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", name: "Bash", input: {} },
        }),
      ]).adapter(input()),
      await fixture([
        sdk({ type: "system", subtype: "model_refusal_fallback" }),
      ]).adapter(input()),
    ];
    for (const turn of failures) {
      const chunks = await collect(turn.result.stream);
      const error = chunks.find((p) => p.type === "error");
      expect(error).toBeDefined();
      expect(String(error?.error)).not.toContain(input().token);
    }
  });

  test("pre-aborted requests never load the runtime", async () => {
    const f = fixture([]);
    const abort = new AbortController();
    abort.abort();
    await expect(
      f.adapter({ ...input(), abortSignal: abort.signal }),
    ).rejects.toThrow();
    expect(f.calls).toBe(0);
  });

  test("aborts an active runtime, closes it, and removes its private directory", async () => {
    const abort = new AbortController();
    let options: Options | undefined;
    let closed = false;
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const adapter = createClaudeSubscriptionAdapter(async () => ({
      query(params) {
        options = params.options;
        return {
          async *[Symbol.asyncIterator]() {
            const mode = (await stat(options!.cwd!)).mode & 0o777;
            expect(mode).toBe(0o700);
            ready();
            await new Promise<void>((resolve) =>
              options!.abortController!.signal.addEventListener(
                "abort",
                () => resolve(),
                { once: true },
              ),
            );
            throw Error(input().token);
          },
          close() {
            closed = true;
          },
        };
      },
    }));
    const turn = await adapter({ ...input(), abortSignal: abort.signal });
    const consuming = collect(turn.result.stream);
    await started;
    abort.abort();
    await consuming;
    // AI SDK may complete its abort stream before the subprocess cleanup finishes.
    for (let i = 0; i < 50 && !closed; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(closed).toBe(true);
    for (let i = 0; i < 50; i++) {
      try {
        await access(options!.cwd!);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw Error("Runtime directory was not removed");
  });

  test("concurrent account turns use separate runtime directories", async () => {
    const a = fixture([result()]);
    const b = fixture([result()]);
    const turns = await Promise.all([
      a.adapter(input()),
      b.adapter({ ...input(), token: "other-account-token" }),
    ]);
    await Promise.all(turns.map((turn) => collect(turn.result.stream)));
    expect(a.options.cwd).not.toBe(b.options.cwd);
    expect(a.options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(input().token);
    expect(b.options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("other-account-token");
  });
});

describe("Claude subscription model listing", () => {
  test("resolves aliases to explicit ids and drops non-Claude rows", () => {
    expect(
      claudeModelsFromRuntime([
        {
          value: "default",
          resolvedModel: "claude-sonnet-5-5",
          displayName: "Default (recommended)",
          description: "",
        },
        {
          value: "sonnet",
          resolvedModel: "claude-sonnet-5-5",
          displayName: "Sonnet 5.5",
          description: "",
          supportsEffort: true,
        },
        {
          value: "claude-haiku-5-5",
          displayName: "Haiku 5.5",
          description: "",
        },
        { value: "custom-model", displayName: "Custom", description: "" },
      ]),
    ).toEqual([
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5", supportsEffort: true },
      { id: "claude-haiku-5-5", name: "Haiku 5.5", supportsEffort: false },
    ]);
  });

  test("accepts prefixed and bare Claude ids only", () => {
    expect(claudeModelId("claude-code/claude-haiku-5-5")).toBe(
      "claude-haiku-5-5",
    );
    expect(claudeModelId("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(() => claudeModelId("opus")).toThrow("explicit Claude model ID");
  });
});
