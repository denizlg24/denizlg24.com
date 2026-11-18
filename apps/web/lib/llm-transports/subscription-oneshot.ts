import type Anthropic from "@anthropic-ai/sdk";
import type { SubscriptionModelProvider } from "@repo/schemas";
import {
  asSchema,
  type FlexibleSchema,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  streamText,
  type ToolSet,
  tool,
  type UserContent,
} from "ai";
import { LlmModelError } from "@/lib/llm-errors";
import {
  chatgptSubscriptionModel,
  chatgptSubscriptionTools,
} from "@/lib/llm-transports/chatgpt-subscription";

/**
 * Single-shot jobs (classification, drafts, forced-tool extraction) on the
 * owner's subscriptions. Everything runs through AI SDK streaming because
 * both runtimes are stream-only, and structured answers are always a forced
 * tool call: neither runtime honours a response format.
 */

export interface SubscriptionTarget {
  provider: SubscriptionModelProvider;
  model: string;
}

export interface SubscriptionUsage {
  inputTokens: number;
  outputTokens: number;
}

interface PreparedModel {
  model: LanguageModel;
  /** Passed to streamText for ChatGPT; Claude takes it as its system prompt. */
  instructions?: string;
  tools: (tools: ToolSet) => ToolSet;
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"];
}

async function prepare(
  target: SubscriptionTarget,
  instructions: string,
): Promise<PreparedModel> {
  if (target.provider === "chatgpt") {
    return {
      model: chatgptSubscriptionModel(target.model),
      instructions,
      tools: chatgptSubscriptionTools,
      providerOptions: {
        openai: { store: false, systemMessageMode: "developer" },
      },
    };
  }
  const [
    { claudeSubscriptionCredential },
    { claudeSubscriptionLanguageModel },
  ] = await Promise.all([
    import("@/lib/ai-subscriptions/service"),
    import("@/lib/llm-transports/claude-subscription"),
  ]);
  const { token } = await claudeSubscriptionCredential();
  return {
    model: await claudeSubscriptionLanguageModel({
      token,
      model: target.model,
      instructions,
    }),
    tools: (tools) => tools,
  };
}

/** Anthropic message content (what job callers build) as AI SDK user content. */
export function userContent(
  content: Anthropic.MessageParam["content"] | undefined,
  prompt: string,
): UserContent {
  if (content === undefined || typeof content === "string")
    return [{ type: "text", text: content ?? prompt }];
  return content.map((block) => {
    if (block.type === "text")
      return { type: "text" as const, text: block.text };
    if (block.type === "image" && block.source.type === "base64")
      return {
        type: "file" as const,
        data: block.source.data,
        mediaType: block.source.media_type,
      };
    if (block.type === "image" && block.source.type === "url")
      return {
        type: "file" as const,
        data: new URL(block.source.url),
        mediaType: "image/*",
      };
    throw new LlmModelError(
      `Subscription models cannot take ${block.type} input.`,
    );
  });
}

async function drain<T extends ToolSet>(
  result: ReturnType<typeof streamText<T>>,
) {
  let failure: unknown;
  await result.consumeStream({
    onError: (error) => {
      failure ??= error;
    },
  });
  if (failure) throw failure;
  const steps = await result.steps;
  const usage = await result.usage;
  return {
    steps,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
  };
}

export async function subscriptionText({
  target,
  system,
  content,
  signal,
}: {
  target: SubscriptionTarget;
  system: string;
  content: UserContent;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: SubscriptionUsage }> {
  const prepared = await prepare(target, system);
  const result = streamText({
    model: prepared.model,
    ...(prepared.instructions ? { instructions: prepared.instructions } : {}),
    messages: [{ role: "user", content }],
    providerOptions: prepared.providerOptions,
    maxRetries: 0,
    abortSignal: signal,
    onError: () => {},
  });
  const { steps, usage } = await drain(result);
  return { text: steps.map((step) => step.text).join(""), usage };
}

export interface SubscriptionServerTool {
  name: string;
  description?: string;
  inputSchema: Anthropic.Tool["input_schema"];
  execute: (input: Record<string, unknown>) => Promise<string> | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lets the model call read tools for as long as it asks, then requires the
 * terminal tool. A model that stops without calling it gets one more round
 * offered only the terminal tool.
 */
export async function subscriptionToolLoop<T>({
  target,
  system,
  content,
  serverTools = [],
  output,
  signal,
}: {
  target: SubscriptionTarget;
  system: string;
  content: UserContent;
  serverTools?: SubscriptionServerTool[];
  output: {
    name: string;
    description?: string;
    schema: FlexibleSchema<T>;
  };
  signal?: AbortSignal;
}): Promise<{
  input: T | undefined;
  usage: SubscriptionUsage;
  rounds: number;
}> {
  const instructions = `${system}\n\nFinish by calling the ${output.name} tool with your answer.`;
  const prepared = await prepare(target, instructions);
  const outputTool = tool({
    description: output.description,
    inputSchema: output.schema,
  });
  const readTools: ToolSet = Object.fromEntries(
    serverTools.map((entry) => [
      entry.name,
      tool({
        description: entry.description,
        inputSchema: jsonSchema<Record<string, unknown>>(entry.inputSchema),
        execute: async (input) => entry.execute(isRecord(input) ? input : {}),
      }),
    ]),
  );
  const usage: SubscriptionUsage = { inputTokens: 0, outputTokens: 0 };
  let rounds = 0;

  const run = async (
    messages: ModelMessage[],
    tools: ToolSet,
    final: boolean,
  ) => {
    const result = streamText({
      model: prepared.model,
      ...(prepared.instructions ? { instructions: prepared.instructions } : {}),
      messages,
      tools: prepared.tools(tools),
      toolChoice: final
        ? { type: "tool", toolName: output.name }
        : serverTools.length
          ? "required"
          : { type: "tool", toolName: output.name },
      stopWhen: ({ steps }) =>
        steps.at(-1)?.toolCalls.some((call) => call.toolName === output.name) ??
        false,
      providerOptions: prepared.providerOptions,
      maxRetries: 0,
      abortSignal: signal,
      onError: () => {},
    });
    const drained = await drain(result);
    usage.inputTokens += drained.usage.inputTokens;
    usage.outputTokens += drained.usage.outputTokens;
    rounds += drained.steps.length;
    const call = drained.steps
      .flatMap((step) => step.toolCalls)
      .findLast((entry) => entry.toolName === output.name);
    return {
      input: call?.input,
      messages: drained.steps.at(-1)?.response.messages ?? [],
    };
  };

  const messages: ModelMessage[] = [{ role: "user", content }];
  const first = await run(
    messages,
    { ...readTools, [output.name]: outputTool },
    false,
  );
  let raw = first.input;
  if (raw === undefined) {
    const second = await run(
      [...messages, ...first.messages],
      { [output.name]: outputTool },
      true,
    );
    raw = second.input;
  }
  if (raw === undefined) return { input: undefined, usage, rounds };
  const validate = asSchema(output.schema).validate;
  if (!validate) throw new LlmModelError("The answer schema cannot validate.");
  const validated = await validate(raw);
  if (!validated.success)
    throw new LlmModelError("The model's answer did not match its schema.");
  return { input: validated.value, usage, rounds };
}
