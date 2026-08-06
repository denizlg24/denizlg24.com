import type { NamespaceWatchMessage } from "@repo/cloud-core";

/**
 * Must stay comfortably under Bun's 10s default idle timeout — this beat is the
 * only thing holding the watch stream open.
 *
 * The obvious alternative does not work here: `server.timeout(request, 0)` is
 * silently a no-op on a `unix:` server. Measured on Bun 1.3.14, the identical
 * handler survives on a `port:` server and is still reaped at ~12s on a socket,
 * which is precisely how this shipped broken. Writing the beat *does* reset the
 * timer on a socket, so a beat under the reaper is the mechanism that works.
 *
 * Getting this wrong is expensive rather than merely untidy: the subscriber
 * reads every drop as an unaccounted gap and answers with a full scan, so a
 * heartbeat slower than the reaper is not a slow watch, it is a scan loop.
 */
export const WATCH_HEARTBEAT_MS = 5_000;

export type WatchSubscribe = (
  send: (message: NamespaceWatchMessage) => void,
) => () => void;

/**
 * Newline-delimited JSON, held open for as long as the subscriber wants it.
 *
 * The subscriber treats a closed stream as a gap it cannot account for and
 * falls back to a full scan, so this never has to replay anything: dropping the
 * connection is always a safe way to fail. It is not a cheap way to fail,
 * though — every drop costs a full scan — so the stream has to survive being
 * idle, which is its normal state. A quiet namespace produces no events for
 * hours.
 *
 * The blank-line heartbeat is what makes that survivable across anything that
 * reaps idle connections — Bun's own server timeout first among them, see
 * WATCH_HEARTBEAT_MS — and it doubles as liveness: a subscriber whose peer has
 * gone finds out at the next beat rather than at the next write.
 *
 * `subscribe` is injected rather than reached for so the stream can be served
 * on its own, which is the only way to test the thing that actually broke: that
 * it outlives the reaper.
 */
export function watchStream(
  request: Request,
  subscribe: WatchSubscribe,
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const body = new ReadableStream<Uint8Array>({
    cancel: stop,
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          stop();
          return false;
        }
      };
      unsubscribe = subscribe((message) => {
        write(`${JSON.stringify(message)}\n`);
      });
      // A bare newline: the subscriber's parser skips empty lines, so this
      // costs one byte and needs no message type of its own.
      heartbeat = setInterval(() => write("\n"), WATCH_HEARTBEAT_MS);
      heartbeat.unref?.();
      request.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      });
    },
  });

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson",
    },
  });
}
