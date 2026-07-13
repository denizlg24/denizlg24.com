import type Anthropic from "@anthropic-ai/sdk";
import type { ClientToolResultInput } from "@/lib/llm-chat";
import { CatalogUnavailableError, LlmModelError } from "@/lib/llm-errors";
import {
  findModel,
  type GatewayModel,
  listModels,
  type ModelFilter,
} from "@/lib/llm-model-catalog";
import { getGatewayAnthropicClient } from "@/lib/llm-transports/anthropic-gateway";
import { requestChatCompletion } from "@/lib/llm-transports/chat-completions";
import { requestEmbedding } from "@/lib/llm-transports/embeddings";
import { connectDB } from "@/lib/mongodb";
import type { TokenUsage } from "@/models/Conversation";
import { LlmUsage } from "@/models/LlmUsage";

// The single application-facing LLM boundary. Every caller goes through the
// operations below; provider transports, model discovery, capability
// validation, usage logging, and cost estimation all live behind it.

export type LlmPurpose =
  | "chat"
  | "llm-api"
  | "enhance-note"
  | "triage-prefilter"
  | "triage-classify"
  | "triage-extract"
  | "note-categorize"
  | "semantic"
  | "topic-classify"
  | "hierarchy-draft"
  | "agent-memory-formation"
  | "agent-memory-embedding"
  | "agent-memory-retrieval";

// Catalog capabilities each purpose requires before a request is sent.
// Per-request needs (tools/web search in chat) are added on top of these.
const PURPOSE_REQUIRED_TAGS: Record<LlmPurpose, string[]> = {
  chat: [],
  "llm-api": [],
  "enhance-note": [],
  "triage-prefilter": ["tool-use"],
  "triage-classify": ["tool-use"],
  "triage-extract": ["tool-use"],
  "note-categorize": [],
  semantic: [],
  "topic-classify": [],
  "hierarchy-draft": [],
  "agent-memory-formation": [],
  "agent-memory-embedding": [],
  "agent-memory-retrieval": [],
};

// Compatibility only: resolves model ids stored before the Gateway migration
// (Mongo triage settings, persisted conversations, desktop clients). This is
// not a selectable-model list — the catalog is.
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-7": "anthropic/claude-opus-4.7",
  "claude-opus-4-6": "anthropic/claude-opus-4.6",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "claude-opus-4-5": "anthropic/claude-opus-4.5",
  "claude-opus-4-5-20251101": "anthropic/claude-opus-4.5",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
  "claude-sonnet-4-5-20250929": "anthropic/claude-sonnet-4.5",
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  "claude-opus-4-1-20250805": "anthropic/claude-opus-4.1",
  "claude-sonnet-4-0": "anthropic/claude-sonnet-4",
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
  "claude-4-sonnet-20250514": "anthropic/claude-sonnet-4",
  "claude-opus-4-0": "anthropic/claude-opus-4",
  "claude-opus-4-20250514": "anthropic/claude-opus-4",
  "claude-4-opus-20250514": "anthropic/claude-opus-4",
  "claude-3-5-haiku-latest": "anthropic/claude-3.5-haiku",
  "claude-3-5-haiku-20241022": "anthropic/claude-3.5-haiku",
  "claude-3-haiku-20240307": "anthropic/claude-3-haiku",
  "deepseek-chat": "deepseek/deepseek-v3.2",
};

// Models known to accept `thinking: {type: "adaptive"}` on the Messages API.
// This is request-option policy, not a selectable list: catalog tags do not
// distinguish adaptive thinking from legacy budget-based thinking.
const ADAPTIVE_THINKING_MODELS = new Set([
  "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.7",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-fable-5",
]);

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

// Unattended-job defaults. Policy, not catalog: overridable via env and
// always fully qualified Gateway ids.
const DEFAULT_SEMANTIC_MODEL = "deepseek/deepseek-v3.2";
const DEFAULT_UNATTENDED_MODEL = "anthropic/claude-haiku-4.5";

export function getSemanticModel(): string {
  return process.env.SEMANTIC_LLM_MODEL?.trim() || DEFAULT_SEMANTIC_MODEL;
}

/** Default model for unattended text jobs (note categorization, drafts). */
export function getUnattendedModel(): string {
  return process.env.LLM_UNATTENDED_MODEL?.trim() || DEFAULT_UNATTENDED_MODEL;
}

export function resolveLegacyAlias(model: string): string {
  return LEGACY_MODEL_ALIASES[model] ?? model;
}

export interface ResolvedModel {
  id: string;
  /** Null when the catalog was cold and the id passed through unvalidated. */
  catalogModel: GatewayModel | null;
}

export interface ResolveModelRequest {
  model: string;
  purpose: LlmPurpose;
  /** Extra capabilities required by this specific request. */
  requiredTags?: string[];
}

/**
 * Maps legacy aliases to Gateway ids and validates the model against the
 * live catalog (type + capability tags). On a cold catalog a fully qualified
 * id passes through so configured defaults keep working; anything else fails.
 */
export async function resolveModel({
  model,
  purpose,
  requiredTags = [],
}: ResolveModelRequest): Promise<ResolvedModel> {
  const id = resolveLegacyAlias(model);
  if (!id.includes("/")) {
    throw new LlmModelError(
      `Unknown model "${model}" — expected a fully qualified Gateway id such as "anthropic/claude-haiku-4.5"`,
    );
  }

  const allRequiredTags = [
    ...new Set([...PURPOSE_REQUIRED_TAGS[purpose], ...requiredTags]),
  ];

  let catalogModel: GatewayModel | null;
  try {
    catalogModel = await findModel(id);
  } catch (error) {
    if (error instanceof CatalogUnavailableError) {
      console.warn(
        `[llm-service] Catalog unavailable; proceeding with configured model "${id}" without capability validation`,
      );
      return { id, catalogModel: null };
    }
    throw error;
  }

  if (!catalogModel) {
    throw new LlmModelError(`Model "${id}" is not in the Gateway catalog`);
  }
  if (catalogModel.type !== "language") {
    throw new LlmModelError(`Model "${id}" is not a language model`);
  }
  for (const tag of allRequiredTags) {
    if (!catalogModel.tags.includes(tag)) {
      throw new LlmModelError(`Model "${id}" does not support "${tag}"`);
    }
  }

  return { id, catalogModel };
}

export async function resolveEmbeddingModel(
  model: string,
): Promise<ResolvedModel> {
  if (!model.includes("/")) {
    throw new LlmModelError(
      `Unknown embedding model "${model}" - expected a fully qualified Gateway id`,
    );
  }
  let catalogModel: GatewayModel | null;
  try {
    catalogModel = await findModel(model);
  } catch (error) {
    if (error instanceof CatalogUnavailableError) {
      console.warn(
        `[llm-service] Catalog unavailable; proceeding with configured embedding model "${model}"`,
      );
      return { id: model, catalogModel: null };
    }
    throw error;
  }
  if (!catalogModel) {
    throw new LlmModelError(
      `Embedding model "${model}" is not in the Gateway catalog`,
    );
  }
  if (!new Set(["embedding", "embed"]).has(catalogModel.type)) {
    throw new LlmModelError(`Model "${model}" is not an embedding model`);
  }
  return { id: model, catalogModel };
}

export interface CacheUsage {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Local cost estimate from live catalog pricing (USD per token, including
 * cache read/write rates). Gateway billed spend stays authoritative. An
 * unknown model is never priced from a generic default — it logs $0 loudly.
 */
export function estimateCost({
  catalogModel,
  inputTokens,
  outputTokens,
  cacheUsage,
}: {
  catalogModel: GatewayModel | null;
  inputTokens: number;
  outputTokens: number;
  cacheUsage?: CacheUsage;
}): number {
  const pricing = catalogModel?.pricing;
  if (
    !pricing ||
    pricing.input === undefined ||
    (outputTokens > 0 && pricing.output === undefined)
  ) {
    console.warn(
      `[llm-service] No catalog pricing for "${catalogModel?.id ?? "unknown model"}"; recording cost as 0`,
    );
    return 0;
  }

  let cost = inputTokens * pricing.input + outputTokens * (pricing.output ?? 0);
  if (cacheUsage) {
    // Cache write/read rates come from the catalog; fall back to the
    // provider-typical multiples of the base input price.
    const cacheWrite = pricing.cacheWrite ?? pricing.input * 1.25;
    const cacheRead = pricing.cacheRead ?? pricing.input * 0.1;
    cost +=
      cacheUsage.cacheCreationInputTokens * cacheWrite +
      cacheUsage.cacheReadInputTokens * cacheRead;
  }
  return cost;
}

export async function logLlmUsage(params: {
  llmModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  systemPrompt: string;
  userPrompt: string;
  source: string;
}): Promise<void> {
  try {
    await connectDB();
    await LlmUsage.create(params);
  } catch (error) {
    console.error("Failed to log LLM usage:", error);
  }
}

export interface LlmRequestContext {
  purpose: LlmPurpose;
  /** Existing usage attribution label. */
  source: string;
  /** Existing conversation identifier, when one is already available. */
  conversationId?: string;
}

function getModelLimits(catalogModel: GatewayModel | null): {
  contextWindow: number;
  maxOutput: number;
} {
  return {
    contextWindow: catalogModel?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxOutput: catalogModel?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

export interface LlmUsageResult {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface EmbedTextRequest extends LlmRequestContext {
  model: string;
  dimensions: number;
  value: string;
}

export interface EmbedTextResult {
  model: string;
  dimensions: number;
  vector: number[];
  usage: LlmUsageResult;
}

export async function embedText({
  source,
  model,
  dimensions,
  value,
}: EmbedTextRequest): Promise<EmbedTextResult> {
  if (!value.trim()) throw new LlmModelError("Embedding input cannot be empty");
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4_096) {
    throw new LlmModelError("Embedding dimensions must be between 1 and 4096");
  }
  const resolved = await resolveEmbeddingModel(model);
  const result = await requestEmbedding({
    model: resolved.id,
    input: value,
    dimensions,
  });
  const usage = {
    inputTokens: result.inputTokens,
    outputTokens: 0,
    costUsd: estimateCost({
      catalogModel: resolved.catalogModel,
      inputTokens: result.inputTokens,
      outputTokens: 0,
    }),
  };
  await logLlmUsage({
    llmModel: resolved.id,
    inputTokens: usage.inputTokens,
    outputTokens: 0,
    costUsd: usage.costUsd,
    systemPrompt: "Generate a semantic embedding.",
    userPrompt: "[agent-memory embedding input redacted]",
    source,
  });
  return {
    model: resolved.id,
    dimensions,
    vector: result.vector,
    usage,
  };
}

export interface GenerateTextRequest extends LlmRequestContext {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TextResult {
  text: string;
  usage: LlmUsageResult;
}

export async function generateText({
  purpose,
  source,
  model,
  system,
  prompt,
  maxTokens,
  temperature,
}: GenerateTextRequest): Promise<TextResult> {
  const resolved = await resolveModel({ model, purpose });
  const client = getGatewayAnthropicClient();
  const limits = getModelLimits(resolved.catalogModel);

  const response = await client.messages.create({
    model: resolved.id as Anthropic.Model,
    max_tokens: Math.min(maxTokens ?? limits.maxOutput, limits.maxOutput),
    ...(temperature !== undefined ? { temperature } : {}),
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: estimateCost({
      catalogModel: resolved.catalogModel,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }),
  };

  logLlmUsage({
    llmModel: resolved.id,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    systemPrompt: system,
    userPrompt: prompt,
    source,
  });

  return { text, usage };
}

export interface GenerateToolResultRequest extends LlmRequestContext {
  model: string;
  system: string;
  prompt: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  temperature?: number;
  /** Override for the logged prompt (e.g. truncated or redacted variants). */
  logUserPrompt?: string;
}

export interface ToolResultOutcome {
  /** The forced tool's input, or undefined when the model produced none. */
  input: Record<string, unknown> | undefined;
  usage: LlmUsageResult;
}

export async function generateToolResult({
  purpose,
  source,
  model,
  system,
  prompt,
  tool,
  maxTokens,
  temperature,
  logUserPrompt,
}: GenerateToolResultRequest): Promise<ToolResultOutcome> {
  const resolved = await resolveModel({ model, purpose });
  const client = getGatewayAnthropicClient();

  const response = await client.messages.create({
    model: resolved.id as Anthropic.Model,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    system,
    tools: [tool],
    tool_choice: {
      type: "tool",
      name: tool.name,
      disable_parallel_tool_use: true,
    },
    messages: [{ role: "user", content: prompt }],
  });

  let input: Record<string, unknown> | undefined;
  for (const block of response.content) {
    if (
      block.type === "tool_use" &&
      block.name === tool.name &&
      typeof block.input === "object" &&
      block.input !== null
    ) {
      input = block.input as Record<string, unknown>;
      break;
    }
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: estimateCost({
      catalogModel: resolved.catalogModel,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }),
  };

  logLlmUsage({
    llmModel: resolved.id,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    systemPrompt: system,
    userPrompt: logUserPrompt ?? prompt,
    source,
  });

  return { input, usage };
}

export interface GenerateJsonRequest extends LlmRequestContext {
  /** Defaults to the configured semantic model. */
  model?: string;
  system: string;
  user: string;
  /** Optional redacted replacement stored in usage logs. */
  logUserPrompt?: string;
  temperature?: number;
}

export interface JsonResult<T> {
  /** Parsed JSON object, or null when the content wasn't parseable. */
  json: T | null;
  content: string;
  usage: LlmUsageResult;
}

function parseJsonObject<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

/**
 * JSON-object generation over Gateway Chat Completions. Transport failures
 * and empty responses throw; unparseable content resolves with json: null so
 * each caller keeps its own failure policy.
 */
export async function generateJson<T>({
  purpose,
  source,
  model,
  system,
  user,
  logUserPrompt,
  temperature,
}: GenerateJsonRequest): Promise<JsonResult<T>> {
  const resolved = await resolveModel({
    model: model ?? getSemanticModel(),
    purpose,
  });

  const result = await requestChatCompletion({
    model: resolved.id,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    jsonObject: true,
  });

  const usage = {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: estimateCost({
      catalogModel: resolved.catalogModel,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    }),
  };

  await logLlmUsage({
    llmModel: resolved.id,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    systemPrompt: system,
    userPrompt: logUserPrompt ?? user,
    source,
  });

  return {
    json: parseJsonObject<T>(result.content),
    content: result.content,
    usage,
  };
}

export interface CountTokensRequest {
  model: string;
  purpose: LlmPurpose;
  system: string;
  prompt: string;
}

export async function countTokens({
  model,
  purpose,
  system,
  prompt,
}: CountTokensRequest): Promise<number> {
  const resolved = await resolveModel({ model, purpose });
  const client = getGatewayAnthropicClient();
  const { input_tokens } = await client.messages.countTokens({
    model: resolved.id as Anthropic.Model,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return input_tokens;
}

export interface StreamTextRequest extends LlmRequestContext {
  model: string;
  system: string;
  prompt: string;
  enableCache?: boolean;
}

/**
 * Basic text SSE stream (`delta`/`done`/`error` events) with the existing
 * token-count preflight to bound max_tokens against the context window.
 */
export async function streamText({
  purpose,
  source,
  model,
  system,
  prompt,
  enableCache = false,
}: StreamTextRequest): Promise<ReadableStream> {
  const resolved = await resolveModel({ model, purpose });
  const client = getGatewayAnthropicClient();
  const limits = getModelLimits(resolved.catalogModel);

  const { input_tokens: inputTokens } = await client.messages.countTokens({
    model: resolved.id as Anthropic.Model,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const maxTokens = Math.max(
    Math.min(limits.maxOutput, limits.contextWindow - inputTokens),
    1,
  );

  const stream = client.messages.stream({
    model: resolved.id as Anthropic.Model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    ...(enableCache ? { cache_control: { type: "ephemeral" as const } } : {}),
  });

  const catalogModel = resolved.catalogModel;
  const modelId = resolved.id;
  let outputTokens = 0;

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        stream.on("text", (delta: string) => {
          send({ type: "delta", text: delta });
        });

        const finalMessage = await stream.finalMessage();
        outputTokens = finalMessage.usage.output_tokens;
        const actualInputTokens = finalMessage.usage.input_tokens;
        const cacheCreationInputTokens =
          finalMessage.usage.cache_creation_input_tokens ?? 0;
        const cacheReadInputTokens =
          finalMessage.usage.cache_read_input_tokens ?? 0;

        const cacheUsage: CacheUsage | undefined = enableCache
          ? { cacheCreationInputTokens, cacheReadInputTokens }
          : undefined;

        const costUsd = estimateCost({
          catalogModel,
          inputTokens: actualInputTokens,
          outputTokens,
          cacheUsage,
        });

        send({
          type: "done",
          usage: {
            inputTokens: actualInputTokens,
            outputTokens,
            ...(enableCache
              ? { cacheCreationInputTokens, cacheReadInputTokens }
              : {}),
            costUsd,
            model: modelId,
          },
        });

        controller.close();

        // Fire-and-forget usage logging
        logLlmUsage({
          llmModel: modelId,
          inputTokens: actualInputTokens,
          outputTokens,
          costUsd,
          systemPrompt: system,
          userPrompt: prompt,
          source,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream error";
        try {
          send({ type: "error", error: message });
          controller.close();
        } catch {
          // Controller may already be closed
        }
      }
    },
    cancel() {
      stream.abort();
    },
  });
}

export interface AgentStreamRequest extends LlmRequestContext {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.ToolUnion[];
  toolApprovals?: Record<string, boolean>;
  clientToolResults?: ClientToolResultInput[];
  onPersist?: (
    messages: Anthropic.MessageParam[],
    tokenUsage?: TokenUsage,
  ) => Promise<void>;
  /** Capability requirements derived from enabled features. */
  requireTools?: boolean;
  requireWebSearch?: boolean;
}

/**
 * The dashboard agent loop. Capability validation happens here, before any
 * upstream stream opens; the loop itself (SSE events, tool ordering,
 * approvals, client tools, persistence) is unchanged.
 */
export async function streamAgent({
  purpose,
  source,
  model,
  system,
  messages,
  tools,
  toolApprovals,
  clientToolResults,
  onPersist,
  requireTools = false,
  requireWebSearch = false,
}: AgentStreamRequest): Promise<ReadableStream> {
  const requiredTags = [
    ...(requireTools ? ["tool-use"] : []),
    ...(requireWebSearch ? ["web-search"] : []),
  ];
  const resolved = await resolveModel({ model, purpose, requiredTags });
  const client = getGatewayAnthropicClient();
  const limits = getModelLimits(resolved.catalogModel);
  const catalogModel = resolved.catalogModel;

  // Loaded lazily: the agent loop drags in the full tools registry, which
  // unattended service consumers (triage, classification jobs) never need.
  const { createAgenticSSEStream } = await import("@/lib/llm-chat");

  return createAgenticSSEStream({
    system,
    messages,
    model: resolved.id,
    tools,
    source,
    toolApprovals,
    clientToolResults,
    onPersist,
    transport: {
      streamMessages: (params) => client.messages.stream(params),
    },
    maxTokens: limits.maxOutput,
    useAdaptiveThinking: ADAPTIVE_THINKING_MODELS.has(resolved.id),
    computeCost: (_model, inputTokens, outputTokens, cacheUsage) =>
      estimateCost({ catalogModel, inputTokens, outputTokens, cacheUsage }),
    logUsage: logLlmUsage,
  });
}

// Catalog listing is re-exported so API routes depend only on the service.
export { type GatewayModel, listModels, type ModelFilter };
