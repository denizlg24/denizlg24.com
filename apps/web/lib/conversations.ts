import { randomUUID } from "node:crypto";
import type { AgentMemoryMode } from "@repo/schemas";
import { Types } from "mongoose";
import {
  Conversation,
  type IConversationMessage,
  type ILeanConversation,
  type StoredContentBlock,
} from "@/models/Conversation";
import { observeConversationMessages } from "./agent-memory/evidence";
import { redactAgentMemorySource } from "./agent-memory/source-deletion";
import { connectDB } from "./mongodb";
import { isClientTool, isWriteTool } from "./tools/registry";

function isToolResultBlock(
  block: StoredContentBlock,
): block is StoredContentBlock & { tool_use_id: string } {
  return block.type === "tool_result" && typeof block.tool_use_id === "string";
}

function isToolUseBlock(
  block: StoredContentBlock,
): block is StoredContentBlock & {
  id: string;
  name: string;
  input: Record<string, unknown>;
} {
  return (
    block.type === "tool_use" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  );
}

function withPendingActions(
  messages: ILeanConversation["messages"],
): ILeanConversation["messages"] {
  const resolvedToolUseIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isToolResultBlock(block)) resolvedToolUseIds.add(block.tool_use_id);
    }
  }

  return messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }

    const pendingActions: NonNullable<IConversationMessage["pendingActions"]> =
      [];
    for (const block of message.content) {
      if (
        !isToolUseBlock(block) ||
        resolvedToolUseIds.has(block.id) ||
        isClientTool(block.name) ||
        !isWriteTool(block.name)
      ) {
        continue;
      }

      pendingActions.push({
        toolId: block.id,
        toolName: block.name,
        input:
          typeof block.input === "object" &&
          block.input !== null &&
          !Array.isArray(block.input)
            ? block.input
            : {},
        status: "pending",
      });
    }

    return pendingActions.length > 0 ? { ...message, pendingActions } : message;
  });
}

interface ConversationListOptions {
  cursor?: string | null;
  offset?: number;
  limit: number;
}

interface ConversationListRow {
  _id: Types.ObjectId;
  title: string;
  llmModel: string;
  memoryMode: AgentMemoryMode;
  updatedAt: Date;
}

interface ConversationCursor {
  _id: Types.ObjectId;
  updatedAt: Date;
}

export class InvalidConversationCursorError extends Error {
  constructor() {
    super("Invalid conversation cursor");
    this.name = "InvalidConversationCursorError";
  }
}

function encodeConversationCursor(conversation: ConversationListRow) {
  return `${conversation.updatedAt.toISOString()}|${conversation._id.toString()}`;
}

function parseConversationCursor(cursor: string | null | undefined) {
  if (!cursor) return null;

  const [updatedAtValue, id] = cursor.split("|");
  const updatedAt = new Date(updatedAtValue ?? "");

  if (
    !updatedAtValue ||
    !id ||
    Number.isNaN(updatedAt.getTime()) ||
    !Types.ObjectId.isValid(id)
  ) {
    throw new InvalidConversationCursorError();
  }

  return {
    _id: new Types.ObjectId(id),
    updatedAt,
  } satisfies ConversationCursor;
}

export async function getAllConversations(options: ConversationListOptions) {
  await connectDB();

  const cursor = parseConversationCursor(options.cursor);
  const query = cursor
    ? {
        $or: [
          { updatedAt: { $lt: cursor.updatedAt } },
          { updatedAt: cursor.updatedAt, _id: { $lt: cursor._id } },
        ],
      }
    : {};
  const effectiveOffset = cursor ? 0 : (options.offset ?? 0);
  const rowsLimit = options.limit + 1;
  const [conversations, totalRows] = await Promise.all([
    Conversation.find(query)
      .select("title llmModel memoryMode updatedAt")
      .sort({ updatedAt: -1, _id: -1 })
      .skip(effectiveOffset)
      .limit(rowsLimit)
      .lean<ConversationListRow[]>(),
    Conversation.countDocuments(),
  ]);
  const pageRows = conversations.slice(0, options.limit);
  const lastPageRow = pageRows.at(-1);
  const nextCursor =
    conversations.length > options.limit && lastPageRow
      ? encodeConversationCursor(lastPageRow)
      : null;

  return {
    conversations: pageRows.map((c) => ({
      _id: c._id.toString(),
      title: c.title,
      llmModel: c.llmModel,
      memoryMode: c.memoryMode ?? "enabled",
      updatedAt: c.updatedAt.toISOString(),
    })),
    totalRows,
    offset: effectiveOffset,
    limit: options.limit,
    nextCursor,
  };
}

export async function getConversation(id: string) {
  await connectDB();

  const conversation = await Conversation.findById(id).lean();
  if (!conversation) return null;

  return {
    _id: conversation._id.toString(),
    title: conversation.title,
    llmModel: conversation.llmModel,
    memoryMode: conversation.memoryMode ?? "enabled",
    messages: withPendingActions(conversation.messages),
    retrievalSummary: conversation.retrievalSummary,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export async function createConversation(data: {
  title: string;
  llmModel: string;
  memoryMode?: AgentMemoryMode;
}) {
  await connectDB();

  const conversation = await Conversation.create({
    title: data.title,
    llmModel: data.llmModel,
    memoryMode: data.memoryMode ?? "enabled",
    messages: [],
  });

  return { ...conversation, _id: conversation._id.toString() };
}

export async function updateConversationMessages(
  id: string,
  messages: ILeanConversation["messages"],
) {
  await connectDB();
  const session = await Conversation.startSession();
  try {
    const conversation = await session.withTransaction(
      async (): Promise<ILeanConversation | null> => {
        const existing = await Conversation.findById(id)
          .select("messages.eventId messages.createdAt memoryMode")
          .session(session)
          .lean<Pick<ILeanConversation, "messages" | "memoryMode">>();
        if (!existing) return null;

        const normalizedMessages = messages.map((message, index) => ({
          ...message,
          eventId:
            existing.messages[index]?.eventId ??
            message.eventId ??
            randomUUID(),
          createdAt: existing.messages[index]?.createdAt ?? message.createdAt,
        }));
        const updated = await Conversation.findByIdAndUpdate(
          id,
          { messages: normalizedMessages, updatedAt: new Date() },
          { returnDocument: "after", session },
        ).lean<ILeanConversation>();
        if (!updated) return null;

        const existingEventIds = new Set(
          existing.messages.map((message) => message.eventId).filter(Boolean),
        );
        const newMessages = updated.messages.filter(
          (message) =>
            !!message.eventId && !existingEventIds.has(message.eventId),
        );
        if (newMessages.length > 0) {
          await observeConversationMessages({
            conversationId: id,
            memoryMode: existing.memoryMode ?? "enabled",
            messages: newMessages,
            session,
          });
        }
        return updated;
      },
    );
    return conversation
      ? { ...conversation, _id: conversation._id.toString() }
      : null;
  } finally {
    await session.endSession();
  }
}

export class IncognitoConversationConflictError extends Error {
  constructor() {
    super("Start a new conversation to use incognito mode");
    this.name = "IncognitoConversationConflictError";
  }
}

export async function updateConversationMemoryMode(
  id: string,
  memoryMode: AgentMemoryMode,
) {
  await connectDB();
  const conversation = await Conversation.findById(id);
  if (!conversation) return null;
  if (memoryMode === "incognito" && conversation.messages.length > 0) {
    throw new IncognitoConversationConflictError();
  }
  conversation.memoryMode = memoryMode;
  await conversation.save();
  return { ...conversation.toObject(), _id: conversation._id.toString() };
}

export async function deleteConversation(id: string): Promise<boolean> {
  await connectDB();

  const exists = await Conversation.exists({ _id: id });
  if (!exists) return false;
  await redactAgentMemorySource({
    entityType: "conversation",
    entityId: id,
  });
  const result = await Conversation.deleteOne({ _id: id });
  return result.deletedCount > 0;
}
