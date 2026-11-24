import { abortLiveTurn, getLiveTurn } from "./live-turns";
import {
  ACTIVE_TURN_LEASE_MS,
  isTurnLive,
  readActiveTurn,
  requestTurnCancel,
} from "./turn-store";

const STOP_WAIT_MS = 8_000;
const STOP_POLL_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stops the conversation's turn wherever it runs and waits until it has
 * stored its interrupted reply and released the thread, so a message sent
 * right after a stop is not refused as "a turn is already running". The flag
 * on the row reaches a turn on another replica at its next heartbeat.
 */
export async function stopConversationTurn(
  conversationId: string,
  options: { waitMs?: number; pollMs?: number } = {},
): Promise<{ stopped: boolean; turnId: string | null }> {
  const turnId = await requestTurnCancel(conversationId);
  const local = getLiveTurn(conversationId);
  abortLiveTurn(conversationId);
  if (!turnId && !local) return { stopped: false, turnId: null };

  const deadline = Date.now() + (options.waitMs ?? STOP_WAIT_MS);
  if (local) {
    await Promise.race([local.done, sleep(Math.max(0, deadline - Date.now()))]);
  }
  while (Date.now() < deadline) {
    const turn = await readActiveTurn(conversationId);
    if (!turn || turn.id !== turnId || !isTurnLive(turn)) break;
    await sleep(options.pollMs ?? STOP_POLL_MS);
  }
  const remaining = await readActiveTurn(conversationId);
  const ended =
    !remaining ||
    remaining.id !== turnId ||
    Date.now() - new Date(remaining.heartbeatAt).getTime() >
      ACTIVE_TURN_LEASE_MS;
  return { stopped: ended, turnId: turnId ?? local?.turnId ?? null };
}
