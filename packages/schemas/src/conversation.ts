import { z } from "zod";
import { agentMemoryModeSchema } from "./agent-memory";

export const chatToolCallSchema = z.object({
  toolId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  status: z.enum(["calling", "done", "error", "pending_approval"]),
});

export type IChatToolCall = z.infer<typeof chatToolCallSchema>;

export const chatContentSegmentSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_group"),
    calls: z.array(chatToolCallSchema),
  }),
]);
export type IChatContentSegment = z.infer<typeof chatContentSegmentSchema>;

export const chatMessageAttachmentSchema = z.object({
  type: z.enum(["image", "pdf"]),
  url: z.string(),
  name: z.string(),
});
export type IChatMessageAttachment = z.infer<
  typeof chatMessageAttachmentSchema
>;

export const chatClientToolResultSchema = z.object({
  toolUseId: z.string(),
  content: z.string(),
  isError: z.boolean().optional(),
});
export type IChatClientToolResult = z.infer<typeof chatClientToolResultSchema>;

export const chatPendingActionSchema = z.object({
  toolId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  status: z.enum(["pending", "approved", "denied"]),
});
export type IChatPendingAction = z.infer<typeof chatPendingActionSchema>;

export const chatMessageSchema = z.object({
  eventId: z.string().uuid().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(z.unknown())]),
  tokenUsage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number(),
    })
    .optional(),
  toolCalls: z.array(chatToolCallSchema).optional(),
  segments: z.array(chatContentSegmentSchema).optional(),
  pendingActions: z.array(chatPendingActionSchema).optional(),
  clientToolResults: z.array(chatClientToolResultSchema).optional(),
  error: z.string().optional(),
  attachments: z.array(chatMessageAttachmentSchema).optional(),
  createdAt: z.string(),
});
export type IChatMessage = z.infer<typeof chatMessageSchema>;

export const conversationSchema = z.object({
  _id: z.string(),
  title: z.string(),
  llmModel: z.string(),
  memoryMode: agentMemoryModeSchema,
  messages: z.array(chatMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IConversation = z.infer<typeof conversationSchema>;

export const conversationMetaSchema = z.object({
  _id: z.string(),
  title: z.string(),
  llmModel: z.string(),
  memoryMode: agentMemoryModeSchema,
  updatedAt: z.string(),
});
export type IConversationMeta = z.infer<typeof conversationMetaSchema>;

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationMetaSchema),
  totalRows: z.number(),
  offset: z.number(),
  limit: z.number(),
  nextCursor: z.string().nullable(),
});
export type ConversationListResponse = z.infer<
  typeof conversationListResponseSchema
>;
