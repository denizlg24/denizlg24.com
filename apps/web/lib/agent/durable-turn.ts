import type { AgentUIMessage } from "@repo/schemas";
import { readUIMessageStream, type UIMessageChunk } from "ai";
import {
  endLiveTurn,
  type LiveTurnEnd,
  publishSnapshot,
  registerLiveTurn,
} from "./live-turns";
import type { TurnHeartbeat } from "./turn-store";

export const TURN_HEARTBEAT_MS = 1_000;
const PUBLISH_THROTTLE_MS = 50;

export interface DurableTurnStore {
  heartbeat(
    snapshot: { seq: number; message: AgentUIMessage } | null,
  ): Promise<TurnHeartbeat>;
  /** Releases the row if the turn still holds it, storing its partial reply as interrupted. */
  finalize(): Promise<void>;
}

export interface DurableTurn {
  turnId: string;
  /** Aborts the model call: a stop from any process, or a lost lease. */
  signal: AbortSignal;
  /**
   * Runs the turn's stream to the end on the server, whoever is listening,
   * and returns a branch for the request that started it. The client going
   * away cancels only its branch.
   */
  attach(
    stream: ReadableStream<UIMessageChunk>,
    baseMessage?: AgentUIMessage,
  ): ReadableStream<UIMessageChunk>;
  /**
   * The final save released the row: stop heartbeating, or the next beat
   * finds the row gone and aborts whatever `onFinish` still has to do.
   */
  released(): void;
  /** The turn never produced a stream; release the thread. */
  fail(): Promise<void>;
  done: Promise<LiveTurnEnd>;
}

/**
 * A turn that belongs to the conversation, not to the request: it is claimed
 * on the row, heartbeats there while it runs (writing the reply as far as it
 * got), and stops when anyone flags the row. Started right after the claim,
 * so a stop during memory recall or connector setup still lands.
 */
export function beginDurableTurn(input: {
  conversationId: string;
  turnId: string;
  store: DurableTurnStore;
  heartbeatMs?: number;
  onError?: (error: unknown) => void;
}): DurableTurn {
  const { conversationId, turnId, store } = input;
  const controller = new AbortController();
  const live = registerLiveTurn({ conversationId, turnId, controller });
  const report = input.onError ?? ((error: unknown) => console.error(error));

  let seq = 0;
  let latest: AgentUIMessage | null = null;
  let dirty = false;
  let lost = false;
  let releasedRow = false;
  let beat: Promise<void> | null = null;

  const heartbeat = () => {
    if (releasedRow) return Promise.resolve();
    if (beat) return beat;
    const snapshot = dirty && latest ? { seq, message: latest } : null;
    dirty = false;
    beat = store
      .heartbeat(snapshot)
      .then((result) => {
        if (releasedRow) return;
        if (result.lost) lost = true;
        if (
          (result.cancelRequested || result.lost) &&
          !controller.signal.aborted
        ) {
          controller.abort(new Error(result.lost ? "Lost" : "Stopped"));
        }
      })
      .catch((error: unknown) => {
        if (snapshot) dirty = true;
        report(error);
      })
      .finally(() => {
        beat = null;
      });
    return beat;
  };
  const timer = setInterval(
    () => void heartbeat(),
    input.heartbeatMs ?? TURN_HEARTBEAT_MS,
  );

  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  const publishNow = () => {
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = null;
    if (latest)
      publishSnapshot(conversationId, turnId, { seq, message: latest });
  };
  const publishSoon = () => {
    publishTimer ??= setTimeout(publishNow, PUBLISH_THROTTLE_MS);
  };

  let settled = false;
  const settle = async () => {
    if (settled) return;
    settled = true;
    clearInterval(timer);
    publishNow();
    if (beat) await beat;
    if (!releasedRow) {
      try {
        await store.finalize();
      } catch (error) {
        report(error);
      }
    }
    const status: LiveTurnEnd = lost
      ? "lost"
      : controller.signal.aborted
        ? "aborted"
        : "finished";
    endLiveTurn(conversationId, turnId, status);
  };

  return {
    turnId,
    signal: controller.signal,
    done: live.done,
    attach(stream, baseMessage) {
      const [response, drain] = stream.tee();
      void (async () => {
        try {
          for await (const message of readUIMessageStream<AgentUIMessage>({
            stream: drain,
            ...(baseMessage ? { message: baseMessage } : {}),
            onError: report,
          })) {
            seq += 1;
            latest = message;
            dirty = true;
            publishSoon();
          }
        } catch (error) {
          report(error);
        } finally {
          await settle();
        }
      })();
      return response;
    },
    released() {
      releasedRow = true;
      clearInterval(timer);
    },
    fail: settle,
  };
}
