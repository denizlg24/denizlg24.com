import { randomUUID } from "node:crypto";
import type { IChatMessage } from "@repo/schemas";
import type {
  IConversationMessage,
  StoredContentBlock,
} from "@/models/Conversation";

function isStoredContentBlock(value: unknown): value is StoredContentBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

export function toStoredMessage(
  message: IChatMessage,
): IConversationMessage | null {
  const createdAt = new Date(message.createdAt);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (
    Array.isArray(message.content) &&
    !message.content.every(isStoredContentBlock)
  ) {
    return null;
  }
  return {
    eventId: message.eventId ?? randomUUID(),
    role: message.role,
    content: message.content,
    tokenUsage: message.tokenUsage,
    retrievalTraceId: message.retrievalTraceId,
    memoryInjected: message.memoryInjected,
    createdAt,
  };
}
