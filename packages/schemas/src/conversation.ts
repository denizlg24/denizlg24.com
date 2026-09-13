import { z } from "zod";
import { agentMemoryModeSchema } from "./agent-memory";

export const chatMessageAttachmentSchema = z.object({
  type: z.enum(["image", "pdf"]),
  url: z.string(),
  name: z.string(),
});
export type IChatMessageAttachment = z.infer<
  typeof chatMessageAttachmentSchema
>;

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

export const updateConversationInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    memoryMode: agentMemoryModeSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });
export type UpdateConversationInput = z.infer<
  typeof updateConversationInputSchema
>;
