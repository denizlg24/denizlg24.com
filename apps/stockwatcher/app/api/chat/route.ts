import { randomUUID } from "node:crypto";
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  type LanguageModelUsage,
  type StepResult,
  safeValidateUIMessages,
  smoothStream,
  streamText,
  type ToolSet,
  toUIMessageStream,
} from "ai";
import { z } from "zod";
import { recordRun, type ToolCallRecord } from "@/lib/admin";
import { aiEnabled, chatModel } from "@/lib/ai/config";
import { chatInstructions } from "@/lib/ai/prompt";
import { createTools, type StockwatcherMessage } from "@/lib/ai/tools";
import { dashboardSchema } from "@/lib/assistant-types";
import { appOrigin, currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace } from "@/lib/db";
import { listMemories, saveThread, threadIdSchema } from "@/lib/memory";
import { symbolPattern } from "@/lib/universes";

export const maxDuration = 120;

const maxBodyBytes = 2_000_000;
const maxMessages = 200;
const modelWindow = 60;
const maxUserText = 8_000;

const requestSchema = z.object({
  id: threadIdSchema,
  messages: z.array(z.looseObject({})).min(1).max(maxMessages),
  context: z
    .object({
      dashboard: dashboardSchema.optional(),
      ticker: z.string().regex(symbolPattern).optional(),
      view: z.string().max(40).optional(),
    })
    .optional(),
});

const textOf = (message: StockwatcherMessage) =>
  message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const titleFor = (messages: StockwatcherMessage[]) => {
  const first = messages.find((message) => message.role === "user");
  const text = first ? textOf(first) : "";
  return (text.length > 80 ? `${text.slice(0, 79)}…` : text) || "New thread";
};

const messageId = createIdGenerator({ prefix: "msg", size: 16 });

function describeError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

function toolRecords<TOOLS extends ToolSet>(
  steps: ReadonlyArray<StepResult<TOOLS>>,
  timings: ReadonlyMap<string, number>,
): ToolCallRecord[] {
  const records = new Map<string, ToolCallRecord>();
  for (const part of steps.flatMap((step) => step.content)) {
    if (part.type === "tool-call")
      records.set(part.toolCallId, {
        id: part.toolCallId,
        name: part.toolName,
        ok: true,
        pending: true,
      });
    else if (part.type === "tool-result" || part.type === "tool-error") {
      const ms = timings.get(part.toolCallId);
      records.set(part.toolCallId, {
        id: part.toolCallId,
        name: part.toolName,
        ok: part.type === "tool-result",
        ...(part.type === "tool-error"
          ? { error: describeError(part.error) }
          : {}),
        ...(ms === undefined ? {} : { ms }),
      });
    }
  }
  return [...records.values()];
}

const sumUsage = <TOOLS extends ToolSet>(
  steps: ReadonlyArray<StepResult<TOOLS>>,
): Pick<LanguageModelUsage, "inputTokens" | "outputTokens"> => ({
  inputTokens: steps.reduce<number | undefined>(
    (sum, step) =>
      step.usage.inputTokens === undefined
        ? sum
        : (sum ?? 0) + step.usage.inputTokens,
    undefined,
  ),
  outputTokens: steps.reduce<number | undefined>(
    (sum, step) =>
      step.usage.outputTokens === undefined
        ? sum
        : (sum ?? 0) + step.usage.outputTokens,
    undefined,
  ),
});

function modelHistory(messages: StockwatcherMessage[]) {
  const recent = messages.slice(-modelWindow);
  const start = recent.findIndex((message) => message.role === "user");
  return start > 0 ? recent.slice(start) : recent;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to use the assistant." }, 401);
  if (!aiEnabled(user))
    return json(
      { error: "The AI assistant is unavailable for this session." },
      503,
    );

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBodyBytes)
    return json({ error: "The conversation is too large." }, 413);
  const raw = await request.text().catch(() => "");
  if (raw.length > maxBodyBytes)
    return json({ error: "The conversation is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const input = requestSchema.safeParse(body);
  if (!input.success)
    return json(
      {
        error: `Invalid chat request. Threads are limited to ${maxMessages} messages.`,
      },
      400,
    );

  const tools = createTools({ user, origin: appOrigin(request) });
  const validated = await safeValidateUIMessages<StockwatcherMessage>({
    messages: input.data.messages,
    tools,
  });
  if (!validated.success)
    return json({ error: "The conversation contains invalid messages." }, 400);
  const messages = validated.data;
  const last = messages.at(-1);
  // A client-side askUser answer resubmits the thread with the assistant
  // message last; the model then continues that same turn.
  const answered =
    last?.role === "assistant" &&
    last.parts.some(
      (part) =>
        part.type === "tool-askUser" && part.state === "output-available",
    );
  if (!last || (last.role !== "user" && !answered))
    return json({ error: "The last message must be from the user." }, 400);
  if (last.role === "user" && textOf(last).length > maxUserText)
    return json(
      {
        error: `Keep messages under ${maxUserText.toLocaleString("en-US")} characters.`,
      },
      400,
    );

  const [workspace, memories] = await Promise.all([
    readWorkspace(user.id),
    listMemories(user.id).catch(() => []),
  ]);

  const threadId = input.data.id;
  const responseId = last.role === "assistant" ? last.id : messageId();
  const lastUser = messages.findLast((message) => message.role === "user");
  const model = chatModel();
  const toolTimings = new Map<string, number>();
  const finishedSteps: StepResult<typeof tools>[] = [];
  let streamError: string | null = null;
  let recorded = false;
  const record = (
    steps: ReadonlyArray<StepResult<typeof tools>>,
    outcome: {
      finishReason: string | null;
      error: string | null;
      usage?: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">;
    },
  ) => {
    if (recorded) return;
    recorded = true;
    const usage = outcome.usage ?? sumUsage(steps);
    const reply = steps
      .map((step) => step.text.trim())
      .filter(Boolean)
      .join("\n\n");
    recordRun({
      id: randomUUID(),
      userId: user.id,
      threadId,
      messageId: responseId,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      model: steps[0]?.model.modelId ?? model.modelId,
      finishReason: outcome.finishReason,
      steps: steps.length,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      toolCalls: toolRecords(steps, toolTimings),
      error: outcome.error,
      prompt: lastUser ? textOf(lastUser) || null : null,
      reply: reply || null,
      context: input.data.context ?? null,
    }).catch((error: unknown) => {
      console.warn("Stockwatcher chat run record failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    });
  };

  const result = streamText({
    model,
    instructions: chatInstructions({
      name: user.name,
      now: new Date(),
      workspace: workspace.data,
      memories,
      context: input.data.context,
    }),
    messages: await convertToModelMessages(modelHistory(messages), {
      tools,
      ignoreIncompleteToolCalls: true,
    }),
    tools,
    stopWhen: isStepCount(14),
    timeout: { totalMs: 110_000 },
    experimental_transform: smoothStream({ chunking: "word" }),
    onToolExecutionEnd: ({ toolCall, toolExecutionMs }) => {
      toolTimings.set(toolCall.toolCallId, Math.round(toolExecutionMs));
    },
    onStepEnd: (step) => {
      finishedSteps.push(step);
    },
    onError: ({ error }) => {
      streamError ??= describeError(error);
      console.warn("Stockwatcher chat stream failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    },
    onEnd: (event) => {
      record(event.steps, {
        finishReason: event.finishReason,
        error: streamError,
        usage: event.totalUsage,
      });
    },
    onAbort: ({ steps, reason }) => {
      record(steps, {
        finishReason: "abort",
        error: `Aborted: ${describeError(reason ?? streamError ?? "no reason given")}`,
      });
    },
  });
  // onEnd runs inside the stream's flush, but an abort settles the stream
  // before onAbort fires, so the fallback waits briefly before recording a
  // run that ended without either callback.
  void Promise.resolve(result.consumeStream())
    .catch(() => undefined)
    .then(() =>
      setTimeout(
        () =>
          record(finishedSteps, {
            finishReason: "error",
            error: streamError ?? "The stream ended without a result.",
          }),
        1_000,
      ),
    );

  return createUIMessageStreamResponse({
    headers: { "Cache-Control": "no-store" },
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      generateMessageId: () => responseId,
      sendSources: true,
      redactToolErrors: false,
      onError: () =>
        "The assistant hit an error. Try again, or rephrase the request.",
      onEnd: async ({ messages: finished }) => {
        try {
          await saveThread(user.id, threadId, titleFor(finished), finished);
        } catch (error) {
          console.warn("Stockwatcher thread save failed", {
            name: error instanceof Error ? error.name : "UnknownError",
          });
        }
      },
    }),
  });
}
