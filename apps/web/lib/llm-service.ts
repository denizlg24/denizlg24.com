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
import {
  type CohereEmbedInputType,
  type MultimodalEmbeddingInput,
  requestMultimodalEmbedding,
} from "@/lib/llm-transports/cohere-embeddings";
import { requestEmbedding } from "@/lib/llm-transports/embeddings";
import { requestTranscription } from "@/lib/llm-transports/openai-transcription";
import { connectDB } from "@/lib/mongodb";
import type { ToolExecutionContext } from "@/lib/tools/types";
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
  | "agent-memory-consolidation"
  | "agent-memory-embedding"
  | "agent-memory-retrieval"
  | "agent-memory-query-summary"
  | "agent-training"
  | "agent-training-learning"
  | "transcription";

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
  "agent-memory-formation": ["tool-use"],
  "agent-memory-consolidation": ["tool-use"],
  "agent-memory-embedding": [],
  "agent-memory-retrieval": [],
  "agent-memory-query-summary": [],
  "agent-training": ["tool-use"],
  "agent-training-learning": ["tool-use"],
  // Never resolved against the catalog: speech models are not in it.
  transcription: [],
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

export interface EmbedMultimodalRequest extends LlmRequestContext {
  model: string;
  dimensions: number;
  /** Each entry becomes one vector; text and image together embed as one item. */
  inputs: MultimodalEmbeddingInput[];
  inputType: CohereEmbedInputType;
}

export interface EmbedMultimodalResult {
  model: string;
  dimensions: number;
  vectors: number[][];
  usage: LlmUsageResult;
}

/**
 * Cohere is not in the Gateway catalog, so pricing cannot be resolved live the
 * way `estimateCost` does for Gateway models. These rates are USD per token and
 * must be updated by hand when Cohere changes them — a stale rate here shows up
 * as wrong spend in LLM usage reporting, not as a failure.
 */
const COHERE_EMBED_PRICING: Record<
  string,
  { inputTokens: number; imageTokens: number }
> = {
  "cohere/embed-v4.0": {
    inputTokens: 0.12 / 1_000_000,
    imageTokens: 0.47 / 1_000_000,
  },
};

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

/**
 * Embeds text, images, or both into one shared vector space, so a text query
 * can retrieve an image and vice versa. Unlike every other operation here this
 * bypasses the Gateway, which cannot express a multimodal embedding request.
 */
export async function embedMultimodal({
  source,
  model,
  dimensions,
  inputs,
  inputType,
}: EmbedMultimodalRequest): Promise<EmbedMultimodalResult> {
  if (inputs.length === 0) {
    throw new LlmModelError("Multimodal embedding requires at least one input");
  }
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4_096) {
    throw new LlmModelError("Embedding dimensions must be between 1 and 4096");
  }

  const result = await requestMultimodalEmbedding({
    model,
    inputs,
    dimensions,
    inputType,
  });

  const pricing = COHERE_EMBED_PRICING[model];
  if (!pricing) {
    console.warn(
      `[llm-service] No local pricing for multimodal model "${model}"; recording cost as 0`,
    );
  }
  const costUsd = pricing
    ? result.inputTokens * pricing.inputTokens +
      result.imageTokens * pricing.imageTokens
    : 0;

  const usage = {
    // Image tokens are billed on a separate meter; fold them in so usage
    // reporting reflects everything that was actually charged.
    inputTokens: result.inputTokens + result.imageTokens,
    outputTokens: 0,
    costUsd,
  };
  await logLlmUsage({
    llmModel: model,
    inputTokens: usage.inputTokens,
    outputTokens: 0,
    costUsd,
    systemPrompt: "Generate a multimodal semantic embedding.",
    userPrompt: "[agent-memory multimodal embedding input redacted]",
    source,
  });

  return { model, dimensions, vectors: result.vectors, usage };
}

/**
 * Speech models are absent from the Gateway catalog, so — exactly as with
 * Cohere above — pricing cannot be resolved live and these rates are USD and
 * hand-maintained. OpenAI bills transcription two different ways: newer models
 * per token (audio and text metered separately), `whisper-1` per minute. A
 * model missing from this table still transcribes; it logs $0 and warns.
 */
const OPENAI_TRANSCRIPTION_PRICING: Record<
  string,
  {
    audioInputTokens?: number;
    textInputTokens?: number;
    textOutputTokens?: number;
    perMinute?: number;
  }
> = {
  "gpt-4o-transcribe": {
    audioInputTokens: 6.0 / 1_000_000,
    textInputTokens: 2.5 / 1_000_000,
    textOutputTokens: 10.0 / 1_000_000,
  },
  "gpt-4o-mini-transcribe": {
    audioInputTokens: 3.0 / 1_000_000,
    textInputTokens: 1.25 / 1_000_000,
    textOutputTokens: 5.0 / 1_000_000,
  },
  "gpt-transcribe": { perMinute: 0.0045 },
  "whisper-1": { perMinute: 0.006 },
};

export interface TranscribeAudioRequest extends LlmRequestContext {
  model: string;
  file: File;
  signal?: AbortSignal;
}

export interface TranscribeAudioResult {
  text: string;
  model: string;
  language?: string;
  /** Audio length, only when the model reports duration rather than tokens. */
  durationSeconds?: number;
  usage: LlmUsageResult;
}

export async function transcribeAudio({
  source,
  model,
  file,
  signal,
}: TranscribeAudioRequest): Promise<TranscribeAudioResult> {
  const result = await requestTranscription({ file, model, signal });

  const pricing = OPENAI_TRANSCRIPTION_PRICING[model];
  const { audioInputTokens, textInputTokens, textOutputTokens, seconds } =
    result.usage;

  // The rate table and the meter OpenAI actually billed on have to agree. A
  // model that switches meters — or a rate entered under the wrong one —
  // otherwise logs a silent $0 that reads as "free" rather than "unpriced".
  let costUsd = 0;
  if (seconds !== undefined) {
    if (pricing?.perMinute === undefined) {
      console.warn(
        `[llm-service] No per-minute rate for transcription model "${model}"; recording cost as 0`,
      );
    } else {
      costUsd = (seconds / 60) * pricing.perMinute;
    }
  } else if (
    pricing?.audioInputTokens === undefined &&
    pricing?.textInputTokens === undefined
  ) {
    console.warn(
      `[llm-service] No per-token rate for transcription model "${model}"; recording cost as 0`,
    );
  } else {
    costUsd =
      audioInputTokens * (pricing.audioInputTokens ?? 0) +
      textInputTokens * (pricing.textInputTokens ?? 0) +
      textOutputTokens * (pricing.textOutputTokens ?? 0);
  }

  const usage = {
    // A per-minute model reports no tokens at all; the cost is still exact, so
    // zeros here mean "not metered in tokens", not "nothing was billed".
    inputTokens: audioInputTokens + textInputTokens,
    outputTokens: textOutputTokens,
    costUsd,
  };
  await logLlmUsage({
    llmModel: model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
    systemPrompt: "Transcribe recorded audio.",
    userPrompt: `[audio ${file.name}, ${file.size} bytes]`,
    source,
  });

  return {
    text: result.text,
    model,
    language: result.language,
    durationSeconds: seconds,
    usage,
  };
}

export interface GenerateTextRequest extends LlmRequestContext {
  model: string;
  system: string;
  /** Redacted replacement for usage logs when the system prompt has private context. */
  logSystemPrompt?: string;
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
  logSystemPrompt,
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
    systemPrompt: logSystemPrompt ?? system,
    userPrompt: prompt,
    source,
  });

  return { text, usage };
}

export interface GenerateToolResultRequest extends LlmRequestContext {
  model: string;
  system: string;
  prompt: string;
  /** Optional multimodal content; `prompt` remains the redacted/loggable text. */
  content?: Anthropic.MessageParam["content"];
  tool: Anthropic.Tool;
  maxTokens: number;
  temperature?: number;
  /** Redacted replacement for usage logs when the system prompt has private context. */
  logSystemPrompt?: string;
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
  content,
  tool,
  maxTokens,
  temperature,
  logSystemPrompt,
  logUserPrompt,
}: GenerateToolResultRequest): Promise<ToolResultOutcome> {
  const resolved = await resolveModel({
    model,
    purpose,
    requiredTags: ["tool-use"],
  });
  const client = getGatewayAnthropicClient();
  const outputLimit = Math.min(
    maxTokens,
    getModelLimits(resolved.catalogModel).maxOutput,
  );

  const response = await client.messages.create({
    model: resolved.id as Anthropic.Model,
    max_tokens: outputLimit,
    ...(temperature !== undefined ? { temperature } : {}),
    system,
    tools: [tool],
    tool_choice: {
      type: "tool",
      name: tool.name,
      disable_parallel_tool_use: true,
    },
    messages: [{ role: "user", content: content ?? prompt }],
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
    systemPrompt: logSystemPrompt ?? system,
    userPrompt: logUserPrompt ?? prompt,
    source,
  });

  return { input, usage };
}

export interface ToolLoopServerTool {
  tool: Anthropic.Tool;
  /** Runs the model's tool call and returns the tool_result text. */
  handler: (input: Record<string, unknown>) => Promise<string> | string;
}

export interface RunToolLoopRequest extends LlmRequestContext {
  model: string;
  /**
   * Invariant system prefix, cached across calls. Request-varying context
   * belongs in `system`, which gets its own breakpoint: it is constant for the
   * duration of one loop, so every round after the first reads it from cache
   * even when it changed since the previous call.
   */
  cachedSystem?: string;
  system: string;
  prompt: string;
  /** Optional multimodal content; `prompt` remains the redacted/loggable text. */
  content?: Anthropic.MessageParam["content"];
  /** Read-only tools the model may call each round; executed server-side. */
  serverTools: ToolLoopServerTool[];
  /** Terminal tool: when the model calls it, its input is returned. */
  outputTool: Anthropic.Tool;
  maxTokens: number;
  temperature?: number;
  /** Model turns allowed before the terminal tool is forced. */
  maxRounds?: number;
  logSystemPrompt?: string;
  logUserPrompt?: string;
}

/**
 * Moves the incremental cache breakpoint onto the final content block, so each
 * round reads the previous rounds' tool results from cache instead of resending
 * them. Blocks are copied rather than mutated because the same array is reused
 * across rounds.
 */
function withMovedCacheBreakpoint(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const marked = messages.map((message) =>
    typeof message.content === "string"
      ? message
      : {
          ...message,
          content: message.content.map((block) =>
            "cache_control" in block && block.cache_control
              ? { ...block, cache_control: null }
              : block,
          ) as Anthropic.MessageParam["content"],
        },
  );

  const last = marked.at(-1);
  if (!last || typeof last.content === "string" || last.content.length === 0) {
    return marked;
  }
  const blocks = [...last.content];
  const finalBlock = blocks.at(-1);
  if (!finalBlock) return marked;
  blocks[blocks.length - 1] = {
    ...finalBlock,
    cache_control: { type: "ephemeral" },
  } as (typeof blocks)[number];
  marked[marked.length - 1] = { ...last, content: blocks };
  return marked;
}

export interface ToolLoopOutcome {
  /** The terminal tool's input, or undefined when the model produced none. */
  input: Record<string, unknown> | undefined;
  usage: LlmUsageResult;
  /** Model turns actually taken, including the forced terminal round. */
  rounds: number;
}

const DEFAULT_TOOL_LOOP_ROUNDS = 6;
const MAX_TOOL_LOOP_ROUNDS = 10;

function firstToolUse(
  content: Anthropic.ContentBlock[],
  accept: (name: string) => boolean,
): { id: string; name: string; input: Record<string, unknown> } | null {
  for (const block of content) {
    if (
      block.type === "tool_use" &&
      accept(block.name) &&
      typeof block.input === "object" &&
      block.input !== null
    ) {
      return {
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
    }
  }
  return null;
}

/**
 * Single-shot forced-tool calls (`generateToolResult`) with a bounded read loop
 * in front: the model may call the provided server tools to gather context, each
 * result is fed back, and the terminal tool is forced on the final round so a
 * structured result always comes back. The existing agent loop is untouched.
 */
export async function runToolLoop({
  purpose,
  source,
  model,
  cachedSystem,
  system,
  prompt,
  content,
  serverTools,
  outputTool,
  maxTokens,
  temperature,
  maxRounds,
  logSystemPrompt,
  logUserPrompt,
}: RunToolLoopRequest): Promise<ToolLoopOutcome> {
  const resolved = await resolveModel({
    model,
    purpose,
    requiredTags: ["tool-use"],
  });
  const client = getGatewayAnthropicClient();
  const outputLimit = Math.min(
    maxTokens,
    getModelLimits(resolved.catalogModel).maxOutput,
  );
  const readRounds = Math.min(
    Math.max(maxRounds ?? DEFAULT_TOOL_LOOP_ROUNDS, 1),
    MAX_TOOL_LOOP_ROUNDS,
  );
  const serverByName = new Map(
    serverTools.map((entry) => [entry.tool.name, entry]),
  );
  const allTools = [...serverTools.map((entry) => entry.tool), outputTool];
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: content ?? prompt },
  ];

  // Anthropic caches the prefix tools -> system -> messages, so the first
  // breakpoint also covers every tool definition. The second one ends the
  // per-call context, which is fixed for this loop and so is read back by
  // every subsequent round.
  const systemParam: Anthropic.MessageCreateParams["system"] = cachedSystem
    ? [
        {
          type: "text",
          text: cachedSystem,
          cache_control: { type: "ephemeral" },
        },
        ...(system
          ? [
              {
                type: "text" as const,
                text: system,
                cache_control: { type: "ephemeral" as const },
              },
            ]
          : []),
      ]
    : system;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let toolInput: Record<string, unknown> | undefined;
  let rounds = 0;

  const call = async (force: boolean) => {
    const response = await client.messages.create({
      model: resolved.id as Anthropic.Model,
      max_tokens: outputLimit,
      ...(temperature !== undefined ? { temperature } : {}),
      system: systemParam,
      tools: force ? [outputTool] : allTools,
      tool_choice: force
        ? {
            type: "tool",
            name: outputTool.name,
            disable_parallel_tool_use: true,
          }
        : { type: "auto", disable_parallel_tool_use: true },
      messages: cachedSystem ? withMovedCacheBreakpoint(messages) : messages,
    });
    rounds += 1;
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    cacheCreationInputTokens += response.usage.cache_creation_input_tokens ?? 0;
    cacheReadInputTokens += response.usage.cache_read_input_tokens ?? 0;
    return response;
  };

  for (let round = 0; round < readRounds && !toolInput; round += 1) {
    const response = await call(false);
    const output = firstToolUse(
      response.content,
      (name) => name === outputTool.name,
    );
    if (output) {
      toolInput = output.input;
      break;
    }
    const read = firstToolUse(response.content, (name) =>
      serverByName.has(name),
    );
    if (!read) break;
    messages.push({ role: "assistant", content: response.content });
    let result: string;
    try {
      result = (await serverByName.get(read.name)?.handler(read.input)) ?? "";
    } catch (error) {
      result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
    }
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: read.id, content: result }],
    });
  }

  if (!toolInput) {
    const response = await call(true);
    const output = firstToolUse(
      response.content,
      (name) => name === outputTool.name,
    );
    if (output) toolInput = output.input;
  }

  const costUsd = estimateCost({
    catalogModel: resolved.catalogModel,
    inputTokens,
    outputTokens,
    cacheUsage: cachedSystem
      ? { cacheCreationInputTokens, cacheReadInputTokens }
      : undefined,
  });
  const usage = { inputTokens, outputTokens, costUsd };
  logLlmUsage({
    llmModel: resolved.id,
    // Cached reads are billed separately and excluded from input_tokens; fold
    // them back in so usage reporting reflects the real prompt size.
    inputTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    outputTokens,
    costUsd,
    systemPrompt: logSystemPrompt ?? system,
    userPrompt: logUserPrompt ?? prompt,
    source,
  });

  return { input: toolInput, usage, rounds };
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
    // `cache_control` is a content-block field, not a top-level one; setting it
    // on the request was silently ignored, so `enableCache` cached nothing.
    system: enableCache
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : system,
    messages: [{ role: "user", content: prompt }],
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
  /** Redacted replacement for usage logs when the system prompt has private context. */
  logSystemPrompt?: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.ToolUnion[];
  toolApprovals?: Record<string, boolean>;
  clientToolResults?: ClientToolResultInput[];
  /**
   * YOLO executes every registered write without an approval round-trip. It is
   * used by unattended training runs and by the owner's explicit chat toggle.
   */
  executionMode?: "interactive" | "yolo";
  /** Model turns allowed before the loop stops. Clamped to [1, 100]. */
  maxIterations?: number;
  /** Per-turn state handed to every server tool execution. */
  toolContext?: ToolExecutionContext;
  onPersist?: (
    messages: Anthropic.MessageParam[],
    tokenUsage?: TokenUsage,
  ) => Promise<void>;
  /** Capability requirements derived from enabled features. */
  requireTools?: boolean;
  requireWebSearch?: boolean;
}

function messagesContainImages(messages: Anthropic.MessageParam[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (block) =>
          block.type === "image" ||
          (block.type === "tool_result" &&
            Array.isArray(block.content) &&
            block.content.some((nested) => nested.type === "image")),
      ),
  );
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
  logSystemPrompt,
  messages,
  tools,
  toolApprovals,
  clientToolResults,
  executionMode = "interactive",
  maxIterations,
  toolContext,
  onPersist,
  requireTools = false,
  requireWebSearch = false,
}: AgentStreamRequest): Promise<ReadableStream> {
  const requiredTags = [
    ...(requireTools ? ["tool-use"] : []),
    ...(requireWebSearch ? ["web-search"] : []),
    ...(messagesContainImages(messages) ? ["vision"] : []),
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
    logSystemPrompt,
    messages,
    model: resolved.id,
    tools,
    source,
    toolApprovals,
    clientToolResults,
    executionMode,
    maxIterations,
    toolContext,
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
