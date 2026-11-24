import type { UIMessage } from "ai";
import { z } from "zod";
import { agentMemoryModeSchema } from "./agent-memory";
import { backgroundAgentPageContextSchema } from "./background-agent";
import { connectorSlugSchema } from "./connectors";
import { studyCitationSchema } from "./study";

/** Tools the desktop page runs itself; the stream carries the call, the client returns the result. */
export const AGENT_PAGE_TOOLS = [
  "get_current_page_context",
  "navigate_desktop",
  "refresh_current_page",
  "read_current_page_aloud",
  "stop_reading_aloud",
] as const;
export type AgentPageTool = (typeof AGENT_PAGE_TOOLS)[number];

export function isAgentPageTool(name: string): name is AgentPageTool {
  return (AGENT_PAGE_TOOLS as readonly string[]).includes(name);
}

/**
 * The agent asks Deniz something and waits: a client tool the composer answers
 * with a questionnaire. The answer is the tool's output, so the same turn
 * resumes from it instead of a new user message starting another.
 */
export const AGENT_QUESTION_TOOL = "ask_user";

/** Tools whose result only an attached client can supply. */
export function isAgentClientTool(name: string): boolean {
  return name === AGENT_QUESTION_TOOL || isAgentPageTool(name);
}

export const AGENT_QUESTIONS_MAX = 4;
export const AGENT_QUESTION_OPTIONS_MAX = 8;

export const agentQuestionOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).optional(),
});

export const agentQuestionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  question: z.string().trim().min(1).max(500),
  /** A one- or two-word chip shown above the question. */
  header: z.string().trim().max(32).optional(),
  options: z
    .array(agentQuestionOptionSchema)
    .min(2)
    .max(AGENT_QUESTION_OPTIONS_MAX),
  multiSelect: z.boolean().optional(),
});
export type AgentQuestion = z.infer<typeof agentQuestionSchema>;

export const agentQuestionInputSchema = z.object({
  questions: z.array(agentQuestionSchema).min(1).max(AGENT_QUESTIONS_MAX),
});
export type AgentQuestionInput = z.infer<typeof agentQuestionInputSchema>;

export const agentQuestionAnswerSchema = z.object({
  id: z.string().max(64),
  /** Labels of the chosen options, in the order they were offered. */
  selected: z.array(z.string().max(120)).max(AGENT_QUESTION_OPTIONS_MAX),
  /** Free text typed instead of, or beside, the options. */
  other: z.string().max(2_000).optional(),
});
export type AgentQuestionAnswer = z.infer<typeof agentQuestionAnswerSchema>;

export const agentQuestionOutputSchema = z.union([
  z.object({
    answers: z.array(agentQuestionAnswerSchema).max(AGENT_QUESTIONS_MAX),
  }),
  z.object({ dismissed: z.literal(true) }),
]);
export type AgentQuestionOutput = z.infer<typeof agentQuestionOutputSchema>;

export const agentUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(),
  reasoningTokens: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative(),
  /** The model's context window, so a meter can show how full it is. */
  contextWindow: z.number().int().positive().optional(),
});
export type AgentUsage = z.infer<typeof agentUsageSchema>;

/** What a turn recorded alongside the message, shown but never sent to the model. */
export const agentMessageMetadataSchema = z.object({
  createdAt: z.iso.datetime().optional(),
  model: z.string().optional(),
  usage: agentUsageSchema.optional(),
  retrievalTraceId: z.string().optional(),
  memoryInjected: z.boolean().optional(),
  finishReason: z.string().optional(),
  /** The turn was stopped, or its server died, before it finished. */
  interrupted: z.boolean().optional(),
  /** The page Deniz was on when he sent the message. */
  page: z
    .object({ pathname: z.string(), title: z.string().optional() })
    .optional(),
  /** Tools menu toggles in force for the turn. */
  tools: z
    .object({
      webSearch: z.boolean().optional(),
      webFetch: z.boolean().optional(),
      thinkLonger: z.boolean().optional(),
    })
    .optional(),
});
export type AgentMessageMetadata = z.infer<typeof agentMessageMetadataSchema>;

export const agentNoticeSchema = z.object({
  level: z.enum(["info", "warning"]),
  text: z.string().max(2_000),
});

export const agentDataPartSchemas = {
  notice: agentNoticeSchema,
  citations: z.array(studyCitationSchema),
};

export type AgentDataTypes = {
  notice: z.infer<typeof agentNoticeSchema>;
  citations: z.infer<typeof studyCitationSchema>[];
};

export type AgentUIMessage = UIMessage<AgentMessageMetadata, AgentDataTypes>;
export type AgentUIMessagePart = AgentUIMessage["parts"][number];

function isUIMessageShape(value: unknown): value is AgentUIMessage {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("role" in value) || !("parts" in value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.role === "user" ||
      value.role === "assistant" ||
      value.role === "system") &&
    Array.isArray(value.parts)
  );
}

/**
 * Structural check only. The server never trusts a client message as a
 * whole: a new user message has its parts filtered, and an assistant message
 * only contributes approval decisions and client-tool results for calls the
 * stored conversation is actually waiting on.
 */
export const agentUIMessageSchema = z.custom<AgentUIMessage>(isUIMessageShape, {
  message: "Expected a UI message",
});

export const agentToolTogglesSchema = z.object({
  webSearch: z.boolean().default(false),
  webFetch: z.boolean().default(false),
  thinkLonger: z.boolean().default(false),
});
export type AgentToolToggles = z.infer<typeof agentToolTogglesSchema>;

export const agentExecutionModeSchema = z.enum(["interactive", "yolo"]);
export type AgentExecutionMode = z.infer<typeof agentExecutionModeSchema>;

export const agentChatRequestSchema = z.object({
  conversationId: z.string().min(1),
  trigger: z.enum(["submit-message", "regenerate-message"]),
  /** A new user message, or the pending assistant message after approvals / client tools. */
  message: agentUIMessageSchema.optional(),
  /** The assistant message to regenerate. */
  messageId: z.string().optional(),
  model: z.string().trim().min(1).max(200),
  tools: agentToolTogglesSchema.default({
    webSearch: false,
    webFetch: false,
    thinkLonger: false,
  }),
  /** Connectors the turn may use; absent means every enabled one. */
  connectors: z.array(connectorSlugSchema).max(32).optional(),
  executionMode: agentExecutionModeSchema.default("interactive"),
  pageContext: backgroundAgentPageContextSchema.optional(),
  responseStyle: z.enum(["voice"]).optional(),
  /** False from a client with no page to read or navigate (the Voice app). */
  pageTools: z.boolean().default(true),
  /** The client draws the questionnaire, so the turn may use `ask_user`. */
  questions: z.boolean().default(false),
  /** The message is the head of the conversation's queue; it leaves the queue as the turn claims it. */
  queuedMessageId: z.string().min(1).max(200).optional(),
});
export type AgentChatRequest = z.infer<typeof agentChatRequestSchema>;
export type AgentChatRequestInput = z.input<typeof agentChatRequestSchema>;

/** A turn running on the server, detached from whichever request started it. */
export const agentActiveTurnSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  /** Bumped with every snapshot the turn writes. */
  seq: z.number().int().nonnegative(),
  /** The assistant message the turn is writing, once it has started one. */
  messageId: z.string().optional(),
  cancelRequested: z.boolean().optional(),
});
export type AgentActiveTurn = z.infer<typeof agentActiveTurnSchema>;

export const AGENT_QUEUE_MAX = 20;

export const agentConversationSchema = z.object({
  _id: z.string(),
  title: z.string(),
  llmModel: z.string(),
  memoryMode: agentMemoryModeSchema,
  /** With a running turn, its in-progress assistant message is already merged in. */
  messages: z.array(agentUIMessageSchema),
  activeTurn: agentActiveTurnSchema.nullable().optional(),
  /** User messages waiting for the running turn to finish, oldest first. */
  queue: z.array(agentUIMessageSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentConversation = z.infer<typeof agentConversationSchema>;

export const agentConversationResponseSchema = z.object({
  conversation: agentConversationSchema,
});
export type AgentConversationResponse = z.infer<
  typeof agentConversationResponseSchema
>;

export const agentQueueInputSchema = z.object({
  message: agentUIMessageSchema,
});
export type AgentQueueInput = z.infer<typeof agentQueueInputSchema>;

export const agentQueueResponseSchema = z.object({
  queue: z.array(agentUIMessageSchema),
});
export type AgentQueueResponse = z.infer<typeof agentQueueResponseSchema>;

export const agentStopResponseSchema = z.object({
  /** A turn was running and has now ended. */
  stopped: z.boolean(),
  turnId: z.string().nullable(),
});
export type AgentStopResponse = z.infer<typeof agentStopResponseSchema>;

/**
 * What `GET chat/{id}/stream` sends while a turn runs. A patch replaces the
 * message's parts from `start` on, so replaying one, or receiving the full
 * snapshot after a partial one, never duplicates text. `seq` only rises
 * within a turn; anything at or below the last applied one is dropped.
 */
export const agentLiveEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("patch"),
    turnId: z.string(),
    seq: z.number().int().nonnegative(),
    messageId: z.string(),
    start: z.number().int().nonnegative(),
    parts: z.array(z.custom<AgentUIMessagePart>()),
    metadata: agentMessageMetadataSchema.optional(),
  }),
  z.object({
    type: z.literal("end"),
    turnId: z.string(),
    status: z.enum(["finished", "aborted", "lost"]),
  }),
]);
export type AgentLiveEvent = z.infer<typeof agentLiveEventSchema>;
export type AgentLivePatch = Extract<AgentLiveEvent, { type: "patch" }>;
