import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type LanguageModel, type LanguageModelUsage, streamText } from "ai";
import type { AgentTurn, AgentTurnRequest } from "../llm-service";

/** Personal account runtime only. token is the output of `claude setup-token`.
 * Install @anthropic-ai/claude-agent-sdk@0.3.326, including optional native binary.
 * No Messages API, gateway, ambient login, or provider fallback is used.
 *
 * The SDK is an inference proxy: MCP advertises schemas but never executes app
 * tools. The outer AI SDK owns execution, approvals and conversation history.
 * Each step replays the updated V4 transcript into a fresh isolated SDK query.
 */
export type ClaudeSubscriptionTurnInput = Pick<
  AgentTurnRequest,
  | "model"
  | "instructions"
  | "messages"
  | "tools"
  | "toolApproval"
  | "abortSignal"
  | "onTurnEnd"
  | "webSearch"
  | "webFetch"
  | "thinkLonger"
> & {
  token: string;
  /** Unknown until SDK modelUsage arrives; 0 means unknown. */
  contextWindow?: number;
};

type RuntimeModel = Extract<LanguageModel, { specificationVersion: "v4" }>;
type RuntimePart =
  Awaited<
    ReturnType<RuntimeModel["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;
type SdkRuntime = {
  query: (params: {
    prompt: string;
    options: Options;
  }) => Pick<Query, typeof Symbol.asyncIterator | "close">;
};

export class ClaudeSubscriptionUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeSubscriptionUnsupportedError";
  }
}

async function loadRuntime(): Promise<SdkRuntime> {
  try {
    return await import("@anthropic-ai/claude-agent-sdk");
  } catch {
    // Never include loader errors: they may contain paths or environment data.
    throw new Error(
      "Claude subscription runtime unavailable. Install @anthropic-ai/claude-agent-sdk@0.3.326 with its platform optional dependency.",
    );
  }
}

function transcriptPrompt(
  prompt: Parameters<RuntimeModel["doStream"]>[0]["prompt"],
): string {
  for (const message of prompt) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (
        part.type === "tool-result" &&
        part.output.type === "content" &&
        part.output.value.some((content) => content.type !== "text")
      ) {
        throw new ClaudeSubscriptionUnsupportedError(
          "Claude subscription cannot replay image or file tool results yet.",
        );
      }
      if (
        ![
          "text",
          "reasoning",
          "tool-call",
          "tool-result",
          "tool-approval-response",
        ].includes(part.type)
      ) {
        throw new ClaudeSubscriptionUnsupportedError(
          "Claude subscription cannot replay image, file or custom content.",
        );
      }
    }
  }
  return (
    "Continue this conversation from its latest entry. This JSON is historical conversation data with original roles, tool calls, approval decisions and tool results. Use completed tool results; never repeat a completed action. App tool names in history correspond to mcp__dashboard__ names.\n" +
    JSON.stringify(prompt)
  );
}

// Build a fresh child environment, never mutate process.env or inherit server
// secrets, API keys, provider routing, proxy settings, or another account login.
function childEnv(directory: string, token: string): Options["env"] {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "LANG", "LC_ALL", "TZ"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return {
    ...env,
    HOME: directory,
    USERPROFILE: directory,
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
    CLAUDE_CONFIG_DIR: join(directory, "config"),
    CLAUDE_CODE_OAUTH_TOKEN: token,
    CLAUDE_AGENT_SDK_CLIENT_APP: "denizlg24-personal-dashboard/1.0.0",
  };
}

/** Factory permits synthetic SDK streams in tests without paid runtime calls. */
export function createClaudeSubscriptionAdapter(
  loadSdk: () => Promise<SdkRuntime>,
) {
  return async function streamClaudeSubscriptionTurn(
    input: ClaudeSubscriptionTurnInput,
  ): Promise<AgentTurn> {
    if (!input.token.trim())
      throw new Error("Claude subscription setup-token is required.");
    if (input.webSearch || input.webFetch || input.thinkLonger) {
      throw new ClaudeSubscriptionUnsupportedError(
        "Claude subscription web search, web fetch and think-longer overrides are not supported by this adapter.",
      );
    }
    const modelId = input.model.replace(/^anthropic\//, "");
    if (!/^claude-[a-zA-Z0-9._-]+$/.test(modelId)) {
      throw new Error(
        "Claude subscription requires an explicit Claude model ID.",
      );
    }
    input.abortSignal?.throwIfAborted();
    const sdk = await loadSdk();
    let contextWindow = input.contextWindow ?? 0;
    const describeUsage = (usage: LanguageModelUsage) => ({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
      // Subscription usage is not an incremental API charge. Do not expose the
      // SDK's equivalent API-dollar estimate as a subscription bill.
      costUsd: 0,
      contextWindow,
    });
    const model: RuntimeModel = {
      specificationVersion: "v4",
      provider: "claude-subscription",
      modelId,
      supportedUrls: {},
      async doGenerate() {
        throw new ClaudeSubscriptionUnsupportedError(
          "Claude subscription is streaming only.",
        );
      },
      async doStream(options) {
        const abort = new AbortController();
        const signal = options.abortSignal;
        const onAbort = () => abort.abort();
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) abort.abort();
        let runtime: ReturnType<SdkRuntime["query"]> | undefined;
        let directory: string | undefined;
        let cancelled = false;
        let closed = false;
        let server: McpServer | undefined;
        const closeRuntime = () => {
          // close() is SDK code too; never allow its raw error into the stream.
          if (closed) return;
          closed = true;
          try {
            runtime?.close();
          } catch {
            /* sanitized; cleanup continues */
          }
        };
        const cleanup = async () => {
          closeRuntime();
          abort.abort();
          await server?.close();
          server = undefined;
          if (directory) {
            await rm(directory, { recursive: true, force: true });
            directory = undefined;
          }
        };
        const stream = new ReadableStream<RuntimePart>({
          async start(controller) {
            const send = (part: RuntimePart) => {
              if (!cancelled) controller.enqueue(part);
            };
            try {
              const prompt = transcriptPrompt(options.prompt);
              const advertised = (options.tools ?? []).map((tool) => {
                if (tool.type !== "function")
                  throw new ClaudeSubscriptionUnsupportedError(
                    "Only app function tools are supported.",
                  );
                return {
                  name: tool.name,
                  description: tool.description,
                  inputSchema: { ...tool.inputSchema, type: "object" as const },
                  _meta: { "anthropic/alwaysLoad": true },
                };
              });
              const allowed = new Set(
                advertised.map((tool) => `mcp__dashboard__${tool.name}`),
              );
              if (advertised.length) {
                server = new McpServer(
                  { name: "dashboard", version: "1.0.0" },
                  { capabilities: { tools: {} } },
                );
                server.server.setRequestHandler(
                  ListToolsRequestSchema,
                  async () => ({ tools: advertised }),
                );
                server.server.setRequestHandler(
                  CallToolRequestSchema,
                  async () => {
                    // Never capture or call an app execute function here. Hold the
                    // SDK agent loop until we close at the assistant boundary.
                    if (!abort.signal.aborted)
                      await new Promise<void>((resolve) => {
                        abort.signal.addEventListener(
                          "abort",
                          () => resolve(),
                          { once: true },
                        );
                      });
                    return {
                      isError: true,
                      content: [
                        {
                          type: "text",
                          text: "Deferred to dashboard approval and execution.",
                        },
                      ],
                    };
                  },
                );
              }
              abort.signal.throwIfAborted();
              directory = await mkdtemp(join(tmpdir(), "claude-subscription-"));
              await mkdir(join(directory, "config"), { mode: 0o700 });
              abort.signal.throwIfAborted();
              runtime = sdk.query({
                prompt,
                options: {
                  model: modelId,
                  ...(process.env.CLAUDE_CODE_EXECUTABLE
                    ? {
                        pathToClaudeCodeExecutable:
                          process.env.CLAUDE_CODE_EXECUTABLE,
                      }
                    : {}),
                  systemPrompt: input.instructions,
                  cwd: directory,
                  env: childEnv(directory, input.token),
                  abortController: abort,
                  includePartialMessages: true,
                  persistSession: false,
                  settingSources: [],
                  settings: { disableAllHooks: true },
                  skills: [],
                  plugins: [],
                  tools: [],
                  allowedTools: [...allowed],
                  mcpServers: server
                    ? {
                        dashboard: {
                          type: "sdk",
                          name: "dashboard",
                          instance: server,
                        },
                      }
                    : {},
                  strictMcpConfig: true,
                  permissionMode: "default",
                  canUseTool: async (name, args) =>
                    allowed.has(name)
                      ? { behavior: "allow", updatedInput: args }
                      : {
                          behavior: "deny",
                          message:
                            "Only advertised dashboard tools are available.",
                        },
                  maxTurns: 1,
                  debug: false,
                  stderr: () => {},
                },
              });
              send({ type: "stream-start", warnings: [] });
              let message = 0;
              let completed = false;
              let sawText = false;
              let stopReason: string | undefined;
              let usage = {
                input_tokens: 0,
                output_tokens: 0,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              };
              const updateUsage = (
                next: { [Key in keyof typeof usage]?: number | null },
              ) => {
                usage = {
                  input_tokens: next.input_tokens ?? usage.input_tokens,
                  output_tokens: next.output_tokens ?? usage.output_tokens,
                  cache_read_input_tokens:
                    next.cache_read_input_tokens ??
                    usage.cache_read_input_tokens,
                  cache_creation_input_tokens:
                    next.cache_creation_input_tokens ??
                    usage.cache_creation_input_tokens,
                };
              };
              const calls = new Map<
                number,
                { id: string; name: string; json: string; initial: unknown }
              >();
              const finishTools = async () => {
                // Validate all calls before exposing any to the outer executor.
                const parts = [...calls.values()].map((call) => ({
                  type: "tool-call" as const,
                  toolCallId: call.id,
                  toolName: call.name.slice("mcp__dashboard__".length),
                  input: JSON.stringify(
                    call.json ? JSON.parse(call.json) : call.initial,
                  ),
                }));
                await cleanup();
                for (const part of parts) send(part);
                const cacheRead = usage.cache_read_input_tokens ?? 0;
                const cacheWrite = usage.cache_creation_input_tokens ?? 0;
                send({
                  type: "finish",
                  finishReason: { unified: "tool-calls", raw: "tool_use" },
                  usage: {
                    inputTokens: {
                      total: usage.input_tokens + cacheRead + cacheWrite,
                      noCache: usage.input_tokens,
                      cacheRead,
                      cacheWrite,
                    },
                    outputTokens: {
                      total: usage.output_tokens,
                      text: undefined,
                      reasoning: undefined,
                    },
                  },
                });
                completed = true;
              };
              const blocks = new Map<
                number,
                { id: string; type: "text" | "reasoning" }
              >();
              for await (const item of runtime) {
                abort.signal.throwIfAborted();
                if (
                  item.type === "system" &&
                  item.subtype === "model_refusal_fallback"
                ) {
                  throw new Error("Runtime model fallback is not supported.");
                }
                if (item.type === "stream_event") {
                  const event = item.event;
                  if (event.type === "message_start") {
                    message++;
                    updateUsage(event.message.usage);
                  }
                  if (event.type === "message_delta") updateUsage(event.usage);
                  if (event.type === "message_stop" && calls.size) {
                    await finishTools();
                    break;
                  }
                  if (
                    event.type === "message_delta" &&
                    event.delta.stop_reason
                  ) {
                    stopReason = event.delta.stop_reason;
                  }
                  if (event.type === "content_block_start") {
                    const block = event.content_block;
                    if (block.type === "tool_use") {
                      if (!allowed.has(block.name) || !block.id)
                        throw new Error("Unexpected runtime tool call.");
                      calls.set(event.index, {
                        id: block.id,
                        name: block.name,
                        json: "",
                        initial: block.input,
                      });
                      continue;
                    }
                    if (block.type === "server_tool_use")
                      throw new Error("Unexpected runtime tool call.");
                    if (block.type !== "text" && block.type !== "thinking")
                      continue;
                    const type = block.type === "text" ? "text" : "reasoning";
                    if (type === "text") sawText = true;
                    const id = `${message}:${event.index}`;
                    blocks.set(event.index, { id, type });
                    send({ type: `${type}-start`, id });
                    const delta =
                      block.type === "text" ? block.text : block.thinking;
                    if (delta) send({ type: `${type}-delta`, id, delta });
                  }
                  if (event.type === "content_block_delta") {
                    const call = calls.get(event.index);
                    if (call && event.delta.type === "input_json_delta")
                      call.json += event.delta.partial_json;
                    const block = blocks.get(event.index);
                    if (!block) continue;
                    const delta =
                      event.delta.type === "text_delta"
                        ? event.delta.text
                        : event.delta.type === "thinking_delta"
                          ? event.delta.thinking
                          : undefined;
                    if (delta)
                      send({
                        type: `${block.type}-delta`,
                        id: block.id,
                        delta,
                      });
                  }
                  if (event.type === "content_block_stop") {
                    const block = blocks.get(event.index);
                    if (block)
                      send({ type: `${block.type}-end`, id: block.id });
                    blocks.delete(event.index);
                  }
                }
                if (item.type === "assistant") {
                  // Some SDK runtimes expose only the completed assistant block.
                  for (const [index, block] of item.message.content.entries()) {
                    if (block.type !== "tool_use") continue;
                    if (!allowed.has(block.name) || !block.id)
                      throw new Error("Unexpected runtime tool call.");
                    if (
                      ![...calls.values()].some((call) => call.id === block.id)
                    ) {
                      calls.set(index, {
                        id: block.id,
                        name: block.name,
                        json: "",
                        initial: block.input,
                      });
                    }
                  }
                  if (calls.size) {
                    updateUsage(item.message.usage);
                    await finishTools();
                    break;
                  }
                }
                if (item.type === "result") {
                  if (item.subtype !== "success" || item.is_error) {
                    throw new Error(
                      "Claude subscription runtime failed; check account authentication, plan limits and model availability.",
                    );
                  }
                  const usage = item.usage;
                  const cacheRead = usage.cache_read_input_tokens ?? 0;
                  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
                  const modelUsage =
                    item.modelUsage[modelId] ??
                    Object.values(item.modelUsage)[0];
                  if (modelUsage) contextWindow = modelUsage.contextWindow;
                  if (!sawText && item.result) {
                    send({ type: "text-start", id: "result" });
                    send({
                      type: "text-delta",
                      id: "result",
                      delta: item.result,
                    });
                    send({ type: "text-end", id: "result" });
                  }
                  stopReason = item.stop_reason ?? stopReason;
                  send({
                    type: "finish",
                    finishReason: {
                      unified:
                        stopReason === "max_tokens"
                          ? "length"
                          : stopReason === "refusal"
                            ? "content-filter"
                            : "stop",
                      raw: stopReason ?? "end_turn",
                    },
                    usage: {
                      inputTokens: {
                        total: usage.input_tokens + cacheRead + cacheWrite,
                        noCache: usage.input_tokens,
                        cacheRead,
                        cacheWrite,
                      },
                      outputTokens: {
                        total: usage.output_tokens,
                        text: undefined,
                        reasoning: undefined,
                      },
                    },
                  });
                  completed = true;
                  break;
                }
              }
              if (!completed)
                throw new Error(
                  "Claude subscription runtime ended without a result.",
                );
            } catch (error) {
              // SDK errors can include child environment, stderr and credential
              // material. Surface a fixed message; never attach the raw cause.
              send({
                type: "error",
                error:
                  error instanceof ClaudeSubscriptionUnsupportedError
                    ? error
                    : abort.signal.aborted
                      ? new DOMException(
                          "Claude subscription turn aborted.",
                          "AbortError",
                        )
                      : new Error(
                          "Claude subscription runtime failed; verify setup-token, plan limits, model and native runtime installation.",
                        ),
              });
            } finally {
              signal?.removeEventListener("abort", onAbort);
              try {
                await cleanup();
              } catch {
                send({
                  type: "error",
                  error: new Error(
                    "Claude subscription runtime directory cleanup failed.",
                  ),
                });
              }
            }
            if (!cancelled) {
              try {
                controller.close();
              } catch {
                /* already errored */
              }
            }
          },
          cancel() {
            cancelled = true;
            abort.abort();
            closeRuntime();
          },
        });
        return { stream };
      },
    };
    const result = streamText({
      model,
      messages: input.messages,
      instructions: input.instructions,
      tools: input.tools,
      ...(input.toolApproval
        ? {
            toolApproval: ({ toolCall }) =>
              input.toolApproval!({
                toolName: toolCall.toolName,
                input: toolCall.input,
              }),
          }
        : {}),
      stopWhen: () => false,
      abortSignal: input.abortSignal,
      // Retrying a runtime turn could consume subscription limits twice.
      maxRetries: 0,
      // The caller receives normalized error parts and owns logging.
      onError: () => {},
      onEnd: async ({ totalUsage, finishReason }) => {
        await input.onTurnEnd?.({
          usage: describeUsage(totalUsage),
          finishReason,
        });
      },
    });
    return {
      result,
      modelId,
      get contextWindow() {
        return contextWindow;
      },
      describeUsage,
    };
  };
}

export const streamClaudeSubscriptionTurn =
  createClaudeSubscriptionAdapter(loadRuntime);
