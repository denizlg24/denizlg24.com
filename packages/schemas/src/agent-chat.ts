import type { UIMessage } from "ai";
import { z } from "zod";
import { agentMemoryModeSchema } from "./agent-memory";
import { backgroundAgentPageContextSchema } from "./background-agent";
import { connectorSlugSchema } from "./connectors";

/** Tools the desktop page runs itself; the stream carries the call, the client returns the result. */
export const AGENT_PAGE_TOOLS = [
  "get_current_page_context",
  "navigate_desktop",
  "refresh_current_page",
] as const;
export type AgentPageTool = (typeof AGENT_PAGE_TOOLS)[number];

export function isAgentPageTool(name: string): name is AgentPageTool {
  return (AGENT_PAGE_TOOLS as readonly string[]).includes(name);
}

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
  /** The loop stopped on its round limit, not because the model was done. */
  stoppedAtMaxRounds: z.boolean().optional(),
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
};

export type AgentDataTypes = {
  notice: z.infer<typeof agentNoticeSchema>;
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
});
export type AgentChatRequest = z.infer<typeof agentChatRequestSchema>;
export type AgentChatRequestInput = z.input<typeof agentChatRequestSchema>;

export const agentConversationSchema = z.object({
  _id: z.string(),
  title: z.string(),
  llmModel: z.string(),
  memoryMode: agentMemoryModeSchema,
  messages: z.array(agentUIMessageSchema),
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
