import {
  AGENT_QUEUE_MAX,
  type AgentActiveTurn,
  type AgentUIMessage,
} from "@repo/schemas";
import { interruptMessage, upsertMessage } from "@repo/utils/agent-live";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  Conversation,
  type IConversationActiveTurn,
} from "@/models/Conversation";
import { sanitizeMessagesForStorage } from "./evidence-units";
import { isAgentUIMessage, normalizeAgentMessage } from "./messages";

/**
 * A running turn's heartbeat is written about once a second; a row whose
 * heartbeat is older than this belongs to a process that died mid-turn.
 * Generous because a heartbeat is a Mongo write, and one slow write must not
 * let a second turn claim a thread the first is still writing.
 */
export const ACTIVE_TURN_LEASE_MS = 45_000;

export function isTurnLive(
  turn: IConversationActiveTurn | null | undefined,
  now = Date.now(),
): turn is IConversationActiveTurn {
  if (!turn?.id) return false;
  return new Date(turn.heartbeatAt).getTime() > now - ACTIVE_TURN_LEASE_MS;
}

export function turnMessage(
  turn: IConversationActiveTurn | null | undefined,
): AgentUIMessage | null {
  const message = turn?.message;
  return isAgentUIMessage(message) ? normalizeAgentMessage(message) : null;
}

/** The thread as a reader should see it: the in-progress reply merged in. */
export function withTurnMessage(
  messages: readonly AgentUIMessage[],
  turn: IConversationActiveTurn | null | undefined,
): AgentUIMessage[] {
  const message = turnMessage(turn);
  return message ? upsertMessage(messages, message) : [...messages];
}

export function activeTurnView(
  turn: IConversationActiveTurn | null | undefined,
  now = Date.now(),
): AgentActiveTurn | null {
  if (!isTurnLive(turn, now)) return null;
  const message = turnMessage(turn);
  return {
    id: turn.id,
    startedAt: new Date(turn.startedAt).toISOString(),
    seq: turn.seq ?? 0,
    ...(message ? { messageId: message.id } : {}),
    ...(turn.cancelRequestedAt ? { cancelRequested: true } : {}),
  };
}

export function queuedMessages(queue: readonly unknown[] | undefined) {
  return (queue ?? []).filter(isAgentUIMessage);
}

function objectId(id: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}

/**
 * Takes the thread for a new turn. Refused while another turn holds a live
 * lease; a dead one's partial reply is settled first, so it is never lost.
 */
export async function claimTurn(
  conversationId: string,
  turnId: string,
): Promise<boolean> {
  await connectDB();
  const _id = objectId(conversationId);
  if (!_id) return false;
  await reapStaleTurn(conversationId);
  const now = new Date();
  const result = await Conversation.updateOne(
    {
      _id,
      $or: [{ activeTurn: null }, { activeTurn: { $exists: false } }],
    },
    {
      $set: {
        activeTurn: {
          id: turnId,
          startedAt: now,
          heartbeatAt: now,
          seq: 0,
        } satisfies IConversationActiveTurn,
      },
    },
  );
  return result.modifiedCount === 1;
}

export interface TurnHeartbeat {
  /** The owner asked for the turn to stop, from this process or another. */
  cancelRequested: boolean;
  /** The row no longer names this turn: it was reaped or replaced. */
  lost: boolean;
}

export async function heartbeatTurn(
  conversationId: string,
  turnId: string,
  snapshot: { seq: number; message: AgentUIMessage } | null,
): Promise<TurnHeartbeat> {
  await connectDB();
  const _id = objectId(conversationId);
  if (!_id) return { cancelRequested: false, lost: true };
  const row = await Conversation.findOneAndUpdate(
    { _id, "activeTurn.id": turnId },
    {
      $set: {
        "activeTurn.heartbeatAt": new Date(),
        ...(snapshot
          ? {
              "activeTurn.seq": snapshot.seq,
              "activeTurn.message": sanitizeMessagesForStorage([
                snapshot.message,
              ])[0],
            }
          : {}),
      },
    },
    { projection: { "activeTurn.cancelRequestedAt": 1 }, timestamps: false },
  ).lean();
  if (!row) return { cancelRequested: false, lost: true };
  return {
    cancelRequested: Boolean(row.activeTurn?.cancelRequestedAt),
    lost: false,
  };
}

/** Flags the running turn for cancellation; the turn's own heartbeat acts on it. */
export async function requestTurnCancel(
  conversationId: string,
): Promise<string | null> {
  await connectDB();
  const _id = objectId(conversationId);
  if (!_id) return null;
  const row = await Conversation.findOneAndUpdate(
    { _id, "activeTurn.id": { $exists: true } },
    { $set: { "activeTurn.cancelRequestedAt": new Date() } },
    { projection: { activeTurn: 1 }, timestamps: false },
  ).lean();
  const turn = row?.activeTurn;
  return isTurnLive(turn) ? turn.id : null;
}

export async function readActiveTurn(
  conversationId: string,
): Promise<IConversationActiveTurn | null> {
  await connectDB();
  const _id = objectId(conversationId);
  if (!_id) return null;
  const row = await Conversation.findById(_id)
    .select("activeTurn")
    .lean<{ activeTurn?: IConversationActiveTurn | null }>();
  return row?.activeTurn ?? null;
}

/**
 * Ends a turn that did not end itself — its process died, or its `onFinish`
 * failed. The partial reply it left is stored as interrupted, and the row is
 * released. Only the named turn is touched: a newer one is never clobbered.
 *
 * The partial goes into `messages` directly rather than through
 * `saveConversationMessages`: it is a fragment, and observing it as memory
 * evidence would pin the fragment's text under the part's stable id.
 */
export async function finalizeTurn(
  conversationId: string,
  turnId: string,
  options: {
    /** Reaping another process's turn: only while its lease is still lapsed. */
    onlyIfStale?: boolean;
  } = {},
): Promise<boolean> {
  await connectDB();
  const _id = objectId(conversationId);
  if (!_id) return false;
  const row = await Conversation.findOne({ _id, "activeTurn.id": turnId })
    .select("messages format activeTurn")
    .lean<{
      messages: unknown[];
      format?: string;
      activeTurn?: IConversationActiveTurn;
    }>();
  if (!row) return false;
  const partial = turnMessage(row.activeTurn);
  const update: Record<string, unknown> = { $unset: { activeTurn: 1 } };
  if (partial && row.format === "ui") {
    const messages = row.messages.filter(isAgentUIMessage);
    update.$set = {
      messages: sanitizeMessagesForStorage(
        upsertMessage(messages, interruptMessage(partial)),
      ),
    };
  }
  // A reap re-checks the lease at write time: a heartbeat landing between
  // the read and this update means the turn is alive, and it keeps the row.
  const result = await Conversation.updateOne(
    {
      _id,
      "activeTurn.id": turnId,
      ...(options.onlyIfStale
        ? {
            "activeTurn.heartbeatAt": {
              $lt: new Date(Date.now() - ACTIVE_TURN_LEASE_MS),
            },
          }
        : {}),
    },
    update,
  );
  return result.modifiedCount === 1;
}

/** Settles a dead turn, if the thread holds one. */
export async function reapStaleTurn(conversationId: string): Promise<void> {
  const turn = await readActiveTurn(conversationId);
  if (!turn) return;
  if (!turn.id) {
    await Conversation.updateOne(
      { _id: conversationId },
      { $unset: { activeTurn: 1 } },
    );
    return;
  }
  const turnId = turn.id;
  if (isTurnLive(turn)) return;
  await finalizeTurn(conversationId, turnId, { onlyIfStale: true });
}

export class QueueFullError extends Error {
  constructor() {
    super(`At most ${AGENT_QUEUE_MAX} messages can wait`);
    this.name = "QueueFullError";
  }
}

export async function enqueueMessage(
  conversationId: string,
  message: AgentUIMessage,
): Promise<AgentUIMessage[] | null> {
  await connectDB();
  const _id = objectId(conversationId);
  if (!_id) return null;
  const exists = await Conversation.exists({ _id });
  if (!exists) return null;
  // Re-sending the same message id is a retry, not a second message.
  await Conversation.updateOne(
    {
      _id,
      "queue.id": { $ne: message.id },
      [`queue.${AGENT_QUEUE_MAX - 1}`]: { $exists: false },
    },
    { $push: { queue: message } },
    { timestamps: false },
  );
  const row = await Conversation.findById(_id).select("queue").lean();
  const queue = queuedMessages(row?.queue);
  if (!queue.some((entry) => entry.id === message.id)) {
    throw new QueueFullError();
  }
  return queue;
}

export async function dequeueMessage(
  conversationId: string,
  messageId: string,
): Promise<AgentUIMessage[] | null> {
  await connectDB();
  const _id = objectId(conversationId);
  if (!_id) return null;
  const row = await Conversation.findOneAndUpdate(
    { _id },
    { $pull: { queue: { id: messageId } } },
    { returnDocument: "after", projection: { queue: 1 }, timestamps: false },
  ).lean();
  if (!row) return null;
  return queuedMessages(row.queue);
}
