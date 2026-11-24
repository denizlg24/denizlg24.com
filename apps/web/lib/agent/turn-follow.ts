import type { AgentLiveEvent, AgentUIMessage } from "@repo/schemas";
import { diffMessageParts } from "@repo/utils/agent-live";
import type { IConversationActiveTurn } from "@/models/Conversation";
import { subscribeLiveTurn } from "./live-turns";
import { isTurnLive, readActiveTurn, turnMessage } from "./turn-store";

const POLL_MS = 750;
const KEEPALIVE_MS = 15_000;

export interface FollowTurnOptions {
  conversationId: string;
  signal?: AbortSignal;
  pollMs?: number;
  keepaliveMs?: number;
  readTurn?: (
    conversationId: string,
  ) => Promise<IConversationActiveTurn | null>;
  subscribe?: typeof subscribeLiveTurn;
}

/**
 * The running turn as Server-Sent Events of `AgentLiveEvent`s. The first
 * patch is always the whole message so far, then each patch carries only
 * what changed since the last one this reader was sent. In the process that
 * runs the turn, snapshots are pushed as they are made; anywhere else the
 * row the turn heartbeats into is polled. Ends with one `end` event.
 */
export function followTurnEvents(
  options: FollowTurnOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const readTurn = options.readTurn ?? readActiveTurn;
  const subscribe = options.subscribe ?? subscribeLiveTurn;
  const cleanups: (() => void)[] = [];
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let sent: AgentUIMessage | null = null;
      let turnId: string | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        for (const cleanup of cleanups) cleanup();
        try {
          controller.close();
        } catch {}
      };
      const emit = (event: AgentLiveEvent) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      const emitMessage = (
        id: string,
        seq: number,
        message: AgentUIMessage,
      ) => {
        const diff = diffMessageParts(sent, message);
        sent = message;
        if (!diff) return;
        emit({
          type: "patch",
          turnId: id,
          seq,
          messageId: message.id,
          start: diff.start,
          parts: diff.parts,
          ...(message.metadata ? { metadata: message.metadata } : {}),
        });
      };
      const end = (status: "finished" | "aborted" | "lost") => {
        emit({ type: "end", turnId: turnId ?? "", status });
        close();
      };

      if (options.signal?.aborted) {
        close();
        return;
      }
      const keepalive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, options.keepaliveMs ?? KEEPALIVE_MS);
      cleanups.push(() => clearInterval(keepalive));
      const onAbort = () => close();
      options.signal?.addEventListener("abort", onAbort);
      cleanups.push(() =>
        options.signal?.removeEventListener("abort", onAbort),
      );

      const local = subscribe(options.conversationId, (event) => {
        if (event.kind === "end") end(event.status);
        else if (turnId) {
          emitMessage(turnId, event.snapshot.seq, event.snapshot.message);
        }
      });
      if (local) {
        cleanups.push(local.unsubscribe);
        turnId = local.turn.turnId;
        const snapshot = local.turn.snapshot;
        if (snapshot) emitMessage(turnId, snapshot.seq, snapshot.message);
        return;
      }

      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      cleanups.push(() => clearTimeout(pollTimer));
      const poll = async () => {
        if (closed) return;
        try {
          const row = await readTurn(options.conversationId);
          if (closed) return;
          if (!row || !isTurnLive(row)) {
            end(row ? "lost" : "finished");
            return;
          }
          if (turnId && row.id !== turnId) {
            // Another turn started; this one is over.
            end("finished");
            return;
          }
          turnId = row.id;
          const message = turnMessage(row);
          if (message) emitMessage(row.id, row.seq ?? 0, message);
        } catch (error) {
          console.error("Following an agent turn failed:", error);
        }
        if (!closed) pollTimer = setTimeout(poll, options.pollMs ?? POLL_MS);
      };
      void poll();
    },
    cancel() {
      closed = true;
      for (const cleanup of cleanups) cleanup();
    },
  });
}
