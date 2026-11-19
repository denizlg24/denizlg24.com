import { expect, test } from "bun:test";
import type { Quote } from "@repo/markets/schemas";
import { type UpstreamStatus, YahooStream } from "./yahoo-stream";

test("resubscribes with the latest union after an upstream disconnect", async () => {
  const disconnected = Promise.withResolvers<void>();
  const reconnected = Promise.withResolvers<Quote>();
  const subscriptions: string[][] = [];
  const states: UpstreamStatus[] = [];
  const worker = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      message(socket, raw) {
        const tickers: [string, ...string[]] = JSON.parse(String(raw));
        subscriptions.push(tickers);
        socket.send(JSON.stringify({ type: "connected" }));
        if (subscriptions.length === 1) {
          socket.close(1000);
          return;
        }
        socket.send(
          JSON.stringify({
            type: "quotes",
            quotes: [
              {
                ticker: tickers[0],
                ts: "2025-01-01T00:00:00Z",
                last: 100,
                open: null,
                high: null,
                low: null,
                prevClose: null,
                volume: null,
                bid: null,
                ask: null,
                source: "ws",
                provider: "yahoo",
              } satisfies Quote,
            ],
          }),
        );
      },
    },
  });

  const stream = new YahooStream(
    `ws://127.0.0.1:${worker.port}`,
    (quotes) => reconnected.resolve(quotes[0]),
    (state) => {
      states.push(state);
      if (state === "disconnected") disconnected.resolve();
    },
  );
  try {
    stream.setSubscriptions(["AAPL"]);
    await disconnected.promise;
    stream.setSubscriptions(["BTC-USD"]);
    expect((await reconnected.promise).ticker).toBe("BTC-USD");
    expect(subscriptions).toEqual([["AAPL"], ["BTC-USD"]]);
    expect(states).toEqual([
      "connecting",
      "connected",
      "disconnected",
      "connecting",
      "connected",
    ]);
    stream.setSubscriptions([]);
    expect(stream.getStatus()).toBe("disconnected");
  } finally {
    stream.setSubscriptions([]);
    worker.stop(true);
  }
});
