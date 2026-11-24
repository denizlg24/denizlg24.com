import type { AgentUIMessage } from "@repo/schemas";

/**
 * Turns this process is running, by conversation. A reader attached here
 * hears every snapshot as it is made; a reader on another replica falls back
 * to polling the row the turn's heartbeat writes. Nothing here is durable —
 * the conversation row is the truth, this is only the fast path.
 */

export type LiveTurnEnd = "finished" | "aborted" | "lost";

export interface LiveTurnSnapshot {
  seq: number;
  message: AgentUIMessage;
}

type Listener =
  | { kind: "snapshot"; snapshot: LiveTurnSnapshot }
  | { kind: "end"; status: LiveTurnEnd };

export interface LiveTurn {
  turnId: string;
  conversationId: string;
  controller: AbortController;
  snapshot: LiveTurnSnapshot | null;
  /** Settles once the turn has persisted its end and released the row. */
  done: Promise<LiveTurnEnd>;
}

interface Entry extends LiveTurn {
  listeners: Set<(event: Listener) => void>;
  resolve: (status: LiveTurnEnd) => void;
}

const GLOBAL_KEY = Symbol.for("denizlg24.agent.liveTurns");
const BY_TURN_KEY = Symbol.for("denizlg24.agent.liveTurnsById");

/** The turn a conversation's readers attach to: the newest one. */
function registry(): Map<string, Entry> {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Map<string, Entry>;
  };
  scope[GLOBAL_KEY] ??= new Map();
  return scope[GLOBAL_KEY];
}

/**
 * Every turn still running here, by turn id. A turn can be replaced in
 * `registry()` before it ends (the thread was released and claimed again
 * while it finished up), and its own readers and `done` must still settle.
 */
function byTurn(): Map<string, Entry> {
  const scope = globalThis as typeof globalThis & {
    [BY_TURN_KEY]?: Map<string, Entry>;
  };
  scope[BY_TURN_KEY] ??= new Map();
  return scope[BY_TURN_KEY];
}

export function registerLiveTurn(input: {
  turnId: string;
  conversationId: string;
  controller: AbortController;
}): LiveTurn {
  let resolve: (status: LiveTurnEnd) => void = () => {};
  const done = new Promise<LiveTurnEnd>((settle) => {
    resolve = settle;
  });
  const entry: Entry = {
    ...input,
    snapshot: null,
    done,
    listeners: new Set(),
    resolve,
  };
  registry().set(input.conversationId, entry);
  byTurn().set(input.turnId, entry);
  return entry;
}

export function getLiveTurn(conversationId: string): LiveTurn | null {
  return registry().get(conversationId) ?? null;
}

export function publishSnapshot(
  conversationId: string,
  turnId: string,
  snapshot: LiveTurnSnapshot,
): void {
  const entry = byTurn().get(turnId);
  if (!entry || entry.conversationId !== conversationId) return;
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) {
    listener({ kind: "snapshot", snapshot });
  }
}

export function endLiveTurn(
  conversationId: string,
  turnId: string,
  status: LiveTurnEnd,
): void {
  const entry = byTurn().get(turnId);
  if (!entry || entry.conversationId !== conversationId) return;
  byTurn().delete(turnId);
  if (registry().get(conversationId) === entry) {
    registry().delete(conversationId);
  }
  for (const listener of entry.listeners) listener({ kind: "end", status });
  entry.listeners.clear();
  entry.resolve(status);
}

/** Aborts the turn if this process runs it; true when it did. */
export function abortLiveTurn(conversationId: string): boolean {
  const entry = registry().get(conversationId);
  if (!entry) return false;
  entry.controller.abort(new Error("Stopped"));
  return true;
}

/**
 * Hears the turn's snapshots from now on. Returns null when this process is
 * not running a turn for the conversation.
 */
export function subscribeLiveTurn(
  conversationId: string,
  listener: (event: Listener) => void,
): { turn: LiveTurn; unsubscribe: () => void } | null {
  const entry = registry().get(conversationId);
  if (!entry) return null;
  entry.listeners.add(listener);
  return {
    turn: entry,
    unsubscribe: () => {
      entry.listeners.delete(listener);
    },
  };
}
