import type { AgentUIMessage } from "@repo/schemas";

/**
 * Messages sent while a turn runs wait on the conversation (server-side, so
 * they survive a refresh and show on every surface) and go out one at a time,
 * oldest first, each as its own turn once the previous one has finished.
 */

export type QueuedMessageState = "sending" | "queued" | "failed";

export interface QueuedMessage {
  message: AgentUIMessage;
  state: QueuedMessageState;
}

/**
 * The server's queue is the truth for what it holds, in its order; entries
 * still on their way there (or that failed to get there) stay at the end in
 * the order they were sent.
 */
export function mergeServerQueue(
  local: readonly QueuedMessage[],
  server: readonly AgentUIMessage[],
  /**
   * Ids already sent from here or already in the thread. A queue read taken
   * before the server dequeued a dispatched head still lists it, and putting
   * it back would send it a second time.
   */
  sent: ReadonlySet<string> = new Set(),
): QueuedMessage[] {
  const held = new Set(server.map((message) => message.id));
  return [
    ...server
      .filter((message) => !sent.has(message.id))
      .map((message) => ({ message, state: "queued" as const })),
    ...local.filter(
      (entry) => entry.state !== "queued" && !held.has(entry.message.id),
    ),
  ];
}

export interface DispatchGate {
  /** A turn streams, is being followed, or is stopping. */
  turnActive: boolean;
  /** The thread waits on an approval or a client tool such as a question. */
  awaitingClient: boolean;
  /** Stopping a turn pauses the queue until Deniz sends again. */
  paused: boolean;
  /** A background run holds the thread. */
  backgroundRun: boolean;
  /** The last turn failed; the queue waits for a retry or a send. */
  failed: boolean;
}

/**
 * The entry to send next, or null. Only the head goes: a head still sending
 * holds the rest back, so order on the server is order of sending.
 */
export function nextQueuedMessage(
  queue: readonly QueuedMessage[],
  gate: DispatchGate,
): QueuedMessage | null {
  if (
    gate.turnActive ||
    gate.awaitingClient ||
    gate.paused ||
    gate.backgroundRun ||
    gate.failed
  ) {
    return null;
  }
  const head = queue[0];
  return head?.state === "queued" ? head : null;
}

/**
 * Whether a new message joins the queue rather than starting a turn: while
 * anything holds the thread, and also while older messages still wait, so a
 * new one never overtakes them.
 */
export function shouldQueueMessage(input: {
  turnActive: boolean;
  awaitingClient: boolean;
  queued: number;
}): boolean {
  return input.turnActive || input.awaitingClient || input.queued > 0;
}

export function queuedText(message: AgentUIMessage): string {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
  if (text) return text;
  const files = message.parts.filter((part) => part.type === "file").length;
  return files === 1 ? "1 attachment" : `${files} attachments`;
}
