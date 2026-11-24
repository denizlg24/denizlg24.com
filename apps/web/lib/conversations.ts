import type {
  AgentMemoryMode,
  AgentUIMessage,
  UpdateConversationInput,
} from "@repo/schemas";
import { type ClientSession, Types } from "mongoose";
import {
  Conversation,
  type IConversationActiveTurn,
  type IConversationMessage,
  type IConversationRetrievalSummary,
} from "@/models/Conversation";
import {
  agentEvidenceUnits,
  sanitizeMessagesForStorage,
} from "./agent/evidence-units";
import { isLegacyConversation, legacyToUIMessages } from "./agent/legacy";
import { abortLiveTurn, getLiveTurn } from "./agent/live-turns";
import { isAgentUIMessage, normalizeAgentMessage } from "./agent/messages";
import { queuedMessages } from "./agent/turn-store";
import { observeConversationMessages } from "./agent-memory/evidence";
import { redactAgentMemorySource } from "./agent-memory/source-deletion";
import { connectDB } from "./mongodb";

function isLegacyMessage(value: unknown): value is IConversationMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "eventId" in value &&
    typeof value.eventId === "string" &&
    "role" in value &&
    (value.role === "user" || value.role === "assistant") &&
    "content" in value
  );
}

/** Stored messages as UI messages, whichever loop wrote them. */
export function storedMessagesToUI(stored: {
  format?: string;
  messages: readonly unknown[];
}): AgentUIMessage[] {
  if (isLegacyConversation(stored.format)) {
    return legacyToUIMessages(stored.messages.filter(isLegacyMessage));
  }
  return stored.messages.filter(isAgentUIMessage).map(normalizeAgentMessage);
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
  const mainThreads = { notebookId: { $exists: false } };
  const query = cursor
    ? {
        ...mainThreads,
        $or: [
          { updatedAt: { $lt: cursor.updatedAt } },
          { updatedAt: cursor.updatedAt, _id: { $lt: cursor._id } },
        ],
      }
    : mainThreads;
  const effectiveOffset = cursor ? 0 : (options.offset ?? 0);
  const rowsLimit = options.limit + 1;
  const [conversations, totalRows] = await Promise.all([
    Conversation.find(query)
      .select("title llmModel memoryMode updatedAt")
      .sort({ updatedAt: -1, _id: -1 })
      .skip(effectiveOffset)
      .limit(rowsLimit)
      .lean<ConversationListRow[]>(),
    Conversation.countDocuments(mainThreads),
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

export interface StoredConversation {
  _id: string;
  title: string;
  llmModel: string;
  memoryMode: AgentMemoryMode;
  messages: AgentUIMessage[];
  /** The running turn's row, live or not; `activeTurnView` decides. */
  activeTurn: IConversationActiveTurn | null;
  queue: AgentUIMessage[];
  retrievalSummary?: IConversationRetrievalSummary;
  createdAt: Date;
  updatedAt: Date;
}

export async function getConversation(
  id: string,
): Promise<StoredConversation | null> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) return null;
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) return null;

  return {
    _id: conversation._id.toString(),
    title: conversation.title,
    llmModel: conversation.llmModel,
    memoryMode: conversation.memoryMode ?? "enabled",
    messages: storedMessagesToUI(conversation),
    activeTurn: conversation.activeTurn ?? null,
    queue: queuedMessages(conversation.queue),
    retrievalSummary: conversation.retrievalSummary,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export async function createConversation(
  data: {
    title: string;
    llmModel: string;
    memoryMode?: AgentMemoryMode;
  },
  options?: { session?: ClientSession },
) {
  await connectDB();

  const conversation = new Conversation({
    title: data.title,
    llmModel: data.llmModel,
    memoryMode: data.memoryMode ?? "enabled",
    format: "ui",
    messages: [],
  });
  await conversation.save({ session: options?.session });

  return { ...conversation, _id: conversation._id.toString() };
}

/**
 * Replaces a thread's messages and observes, as memory evidence, only the
 * parts this save added — a resumed turn re-saves the whole assistant message
 * with one more tool result, and only that result is new.
 */
export async function saveConversationMessages(
  id: string,
  messages: readonly AgentUIMessage[],
  options?: {
    llmModel?: string;
    /** Writes only while this turn holds the thread. */
    whileTurnId?: string;
    /** As `whileTurnId`, and releases the hold in the same write. */
    endTurnId?: string;
  },
): Promise<boolean> {
  await connectDB();
  const session = await Conversation.startSession();
  try {
    return await session.withTransaction(async () => {
      const existing = await Conversation.findById(id)
        .select("messages format memoryMode")
        .session(session)
        .lean();
      if (!existing) return false;

      const seen = new Set(
        agentEvidenceUnits(storedMessagesToUI(existing)).map(
          (unit) => unit.eventId,
        ),
      );
      const stored = sanitizeMessagesForStorage(messages);
      // A turn's final save lands only while the turn still holds the row:
      // one that lost its lease (reaped while its process could not reach
      // Mongo) would otherwise replace the newer turn's thread with its own.
      const holder = options?.endTurnId ?? options?.whileTurnId;
      const written = await Conversation.updateOne(
        holder ? { _id: id, "activeTurn.id": holder } : { _id: id },
        {
          $set: {
            messages: stored,
            format: "ui",
            updatedAt: new Date(),
            ...(options?.llmModel ? { llmModel: options.llmModel } : {}),
          },
          ...(options?.endTurnId ? { $unset: { activeTurn: 1 } } : {}),
        },
        { session },
      );
      if (written.matchedCount === 0) return false;

      const added = agentEvidenceUnits(stored).filter(
        (unit) => !seen.has(unit.eventId),
      );
      if (added.length > 0) {
        await observeConversationMessages({
          conversationId: id,
          memoryMode: existing.memoryMode ?? "enabled",
          messages: added,
          session,
        });
      }
      return true;
    });
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

export async function updateConversation(
  id: string,
  input: UpdateConversationInput,
) {
  await connectDB();
  const conversation = await Conversation.findById(id);
  if (!conversation) return null;
  if (
    input.memoryMode === "incognito" &&
    conversation.memoryMode !== "incognito" &&
    conversation.messages.length > 0
  ) {
    throw new IncognitoConversationConflictError();
  }
  if (input.memoryMode !== undefined)
    conversation.memoryMode = input.memoryMode;
  if (input.title !== undefined) conversation.title = input.title;
  await conversation.save();
  return getConversation(id);
}

export async function deleteConversation(id: string): Promise<boolean> {
  await connectDB();

  const exists = await Conversation.exists({ _id: id });
  if (!exists) return false;
  // The aborted turn's final save observes evidence; redacting before it
  // lands would leave that evidence behind the deletion.
  const live = getLiveTurn(id);
  abortLiveTurn(id);
  if (live) {
    await Promise.race([
      live.done,
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  await redactAgentMemorySource({
    entityType: "conversation",
    entityId: id,
  });
  const result = await Conversation.deleteOne({ _id: id });
  return result.deletedCount > 0;
}
