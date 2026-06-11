import Anthropic from "@anthropic-ai/sdk";
import { connectDB } from "@/lib/mongodb";
import { LlmUsage } from "@/models/LlmUsage";

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not defined");
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Cost per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  // Claude 4.7 family
  "claude-opus-4-7": { input: 5, output: 25 },

  // Claude 4.6 family
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },

  // Claude 4.5 family
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-5-20251101": { input: 5, output: 25 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },

  // Claude 4.1
  "claude-opus-4-1-20250805": { input: 15, output: 75 },

  // Claude 4.0
  "claude-sonnet-4-0": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-4-sonnet-20250514": { input: 3, output: 15 }, // non-canonical alias
  "claude-opus-4-0": { input: 15, output: 75 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-4-opus-20250514": { input: 15, output: 75 }, // non-canonical alias

  // Claude 3.x
  "claude-3-7-sonnet-latest": { input: 3, output: 15 },
  "claude-3-7-sonnet-20250219": { input: 3, output: 15 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-latest": { input: 15, output: 75 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
};

// Cache pricing multipliers (relative to base input price)
// Cache writes cost 1.25x base input price, cache reads cost 0.1x base input price
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// Context window and max output tokens per model
const MODEL_LIMITS: Record<string, { context: number; maxOutput: number }> = {
  // Claude 4.7 family
  "claude-opus-4-7": { context: 200000, maxOutput: 128000 }, // 1M ctx via beta header

  // Claude 4.6 family
  "claude-opus-4-6": { context: 200000, maxOutput: 128000 }, // 1M ctx via beta header
  "claude-sonnet-4-6": { context: 200000, maxOutput: 64000 }, // 1M ctx via beta header

  // Claude 4.5 family — all 64K max output
  "claude-opus-4-5": { context: 200000, maxOutput: 64000 },
  "claude-opus-4-5-20251101": { context: 200000, maxOutput: 64000 },
  "claude-sonnet-4-5": { context: 200000, maxOutput: 64000 }, // 1M ctx via beta header
  "claude-sonnet-4-5-20250929": { context: 200000, maxOutput: 64000 },
  "claude-haiku-4-5": { context: 200000, maxOutput: 64000 },
  "claude-haiku-4-5-20251001": { context: 200000, maxOutput: 64000 },

  // Claude 4.1
  "claude-opus-4-1-20250805": { context: 200000, maxOutput: 32000 },

  // Claude 4.0
  "claude-sonnet-4-0": { context: 200000, maxOutput: 64000 },
  "claude-sonnet-4-20250514": { context: 200000, maxOutput: 64000 },
  "claude-4-sonnet-20250514": { context: 200000, maxOutput: 64000 },
  "claude-opus-4-0": { context: 200000, maxOutput: 32000 },
  "claude-opus-4-20250514": { context: 200000, maxOutput: 32000 },
  "claude-4-opus-20250514": { context: 200000, maxOutput: 32000 },

  // Claude 3.x
  "claude-3-7-sonnet-latest": { context: 200000, maxOutput: 64000 }, // 128K via beta header
  "claude-3-7-sonnet-20250219": { context: 200000, maxOutput: 64000 },
  "claude-3-5-haiku-latest": { context: 200000, maxOutput: 8192 },
  "claude-3-5-haiku-20241022": { context: 200000, maxOutput: 8192 },
  "claude-3-opus-latest": { context: 200000, maxOutput: 4096 },
  "claude-3-opus-20240229": { context: 200000, maxOutput: 4096 },
  "claude-3-haiku-20240307": { context: 200000, maxOutput: 4096 },
};

const DEFAULT_LIMITS = { context: 200000, maxOutput: 8192 };
const DEFAULT_PRICING = { input: 3, output: 15 };

export function getMaxTokens(model: string): number {
  return (MODEL_LIMITS[model] ?? DEFAULT_LIMITS).maxOutput;
}

export function getContextWindow(model: string): number {
  return (MODEL_LIMITS[model] ?? DEFAULT_LIMITS).context;
}

// Models that support `thinking: {type: "adaptive"}`.
// Adaptive thinking auto-enables interleaved thinking and works
// seamlessly with tool use — no beta header needed.
const ADAPTIVE_THINKING_MODELS = new Set([
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
]);

export function supportsAdaptiveThinking(model: string): boolean {
  return ADAPTIVE_THINKING_MODELS.has(model);
}

export interface CacheUsage {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheUsage?: CacheUsage,
): number {
  const pricing = PRICING[model] ?? DEFAULT_PRICING;

  let inputCost: number;

  if (cacheUsage) {
    const cacheWriteCost =
      (cacheUsage.cacheCreationInputTokens *
        pricing.input *
        CACHE_WRITE_MULTIPLIER) /
      1_000_000;
    const cacheReadCost =
      (cacheUsage.cacheReadInputTokens *
        pricing.input *
        CACHE_READ_MULTIPLIER) /
      1_000_000;
    const uncachedInputCost = (inputTokens * pricing.input) / 1_000_000;
    inputCost = cacheWriteCost + cacheReadCost + uncachedInputCost;
  } else {
    inputCost = (inputTokens * pricing.input) / 1_000_000;
  }

  const outputCost = (outputTokens * pricing.output) / 1_000_000;
  return inputCost + outputCost;
}

async function calculateSafeMaxTokens({
  model,
  system,
  prompt,
}: {
  model: Anthropic.Model;
  system: string;
  prompt: string;
}): Promise<{ maxTokens: number; inputTokens: number }> {
  const { input_tokens: inputTokens } = await anthropic.messages.countTokens({
    model,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const maxTokens = Math.min(
    getMaxTokens(model),
    getContextWindow(model) - inputTokens,
  );

  return { maxTokens: Math.max(maxTokens, 1), inputTokens };
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
  } catch (err) {
    console.error("Failed to log LLM usage:", err);
  }
}

export type StreamResult = {
  stream: ReturnType<typeof anthropic.messages.stream>;
  model: string;
  system: string;
  prompt: string;
  source: string;
  inputTokens: number;
  enableCache?: boolean;
};

export async function streamGenerate({
  system,
  prompt,
  model = "claude-sonnet-4-5-20250929",
  source = "unknown",
  enableCache = false,
}: {
  system: string;
  prompt: string;
  model?: Anthropic.Model;
  source?: string;
  enableCache?: boolean;
}): Promise<StreamResult> {
  const { maxTokens, inputTokens } = await calculateSafeMaxTokens({
    model,
    system,
    prompt,
  });

  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    ...(enableCache ? { cache_control: { type: "ephemeral" as const } } : {}),
  });

  return { stream, model, system, prompt, source, inputTokens, enableCache };
}

export function createSSEStream(result: StreamResult): ReadableStream {
  const { stream, model, system, prompt, source, enableCache } = result;
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
          ? {
              cacheCreationInputTokens,
              cacheReadInputTokens,
            }
          : undefined;

        const costUsd = calculateCost(
          model,
          actualInputTokens,
          outputTokens,
          cacheUsage,
        );

        send({
          type: "done",
          usage: {
            inputTokens: actualInputTokens,
            outputTokens,
            ...(enableCache
              ? { cacheCreationInputTokens, cacheReadInputTokens }
              : {}),
            costUsd,
            model,
          },
        });

        controller.close();

        // Fire-and-forget usage logging
        logLlmUsage({
          llmModel: model,
          inputTokens: actualInputTokens,
          outputTokens,
          costUsd,
          systemPrompt: system,
          userPrompt: prompt,
          source,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream error";
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
