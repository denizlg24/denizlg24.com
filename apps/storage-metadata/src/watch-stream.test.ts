import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";

import { WATCH_HEARTBEAT_MS, watchStream } from "./watch-stream";

/**
 * Bun's `Bun.serve` default. The watch stream has to outlive it on its own,
 * because the per-request escape hatch is unavailable on a unix socket.
 */
const BUN_DEFAULT_IDLE_TIMEOUT_MS = 10_000;

function serve(socketPath: string) {
  try {
    unlinkSync(socketPath);
  } catch {
    // Nothing to clean up.
  }
  return Bun.serve({
    fetch: (request) => watchStream(request, () => () => {}),
    unix: socketPath,
  });
}

describe("watch stream", () => {
  test("heartbeat is faster than the reaper it exists to satisfy", () => {
    expect(WATCH_HEARTBEAT_MS).toBeLessThan(BUN_DEFAULT_IDLE_TIMEOUT_MS);
  });

  // The regression this file exists for. A 15s heartbeat under a 10s reaper
  // dropped the stream every ~12s, and every drop cost the subscriber a full
  // namespace scan. Only a real socket reproduces it: the same handler on a
  // `port:` server survives, so nothing short of this catches a return to
  // `server.timeout(request, 0)` or a slower beat.
  test(
    "outlives Bun's idle timeout on a unix socket",
    async () => {
      const socketPath = `/tmp/watch-stream-test-${process.pid}.sock`;
      const server = serve(socketPath);
      const controller = new AbortController();
      const deadline = BUN_DEFAULT_IDLE_TIMEOUT_MS + 4_000;
      const timer = setTimeout(() => controller.abort(), deadline);

      let beats = 0;
      let dropped: string | null = null;
      const startedAt = Date.now();
      try {
        const response = await fetch("http://metadata/v1/watch", {
          signal: controller.signal,
          unix: socketPath,
        } as RequestInit & { unix: string });
        const stream = response.body as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of stream) beats += chunk.length;
        dropped = "stream ended";
      } catch (error) {
        if (!controller.signal.aborted) {
          dropped = (error as Error).message;
        }
      } finally {
        clearTimeout(timer);
        server.stop(true);
        try {
          unlinkSync(socketPath);
        } catch {
          // Already gone.
        }
      }

      expect({ afterMs: Date.now() - startedAt, dropped }).toEqual({
        afterMs: expect.any(Number),
        dropped: null,
      });
      expect(beats).toBeGreaterThan(0);
    },
    BUN_DEFAULT_IDLE_TIMEOUT_MS + 15_000,
  );
});
