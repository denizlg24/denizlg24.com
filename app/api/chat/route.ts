import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  safeValidateUIMessages,
  smoothStream,
  streamText,
  toUIMessageStream,
} from "ai";
import { z } from "zod";
import { appOrigin, currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace } from "@/lib/db";
import { listMemories, saveThread, threadIdSchema } from "@/lib/memory";
import { dashboardSchema } from "@/lib/assistant-types";
import { symbolPattern } from "@/lib/universes";
import { aiEnabled, chatModel } from "@/lib/ai/config";
import { chatInstructions } from "@/lib/ai/prompt";
import { createTools, type StockwatcherMessage } from "@/lib/ai/tools";

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

function modelHistory(messages: StockwatcherMessage[]) {
  const recent = messages.slice(-modelWindow);
  const start = recent.findIndex((message) => message.role === "user");
  return start > 0 ? recent.slice(start) : recent;
}

export async function POST(request: Request) {
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
  if (!last || last.role !== "user")
    return json({ error: "The last message must be from the user." }, 400);
  if (textOf(last).length > maxUserText)
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
  const result = streamText({
    model: chatModel(),
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
    onError: ({ error }) => {
      console.warn("Stockwatcher chat stream failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    },
  });
  result.consumeStream();

  return createUIMessageStreamResponse({
    headers: { "Cache-Control": "no-store" },
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
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
