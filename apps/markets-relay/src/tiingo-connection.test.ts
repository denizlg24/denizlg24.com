import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TiingoSocket } from "./tiingo-socket";

/**
 * These cover the connection lifecycle rather than the wire format. Both cases
 * below were live bugs that between them opened a Tiingo socket per second and
 * drained the daily budget, so they are worth pinning down.
 */

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;

  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, (event: unknown) => void>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.set(type, handler);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  /** The keep-alive is a control frame, not a message; it sends nothing. */
  ping() {
    this.pings++;
  }

  pings = 0;

  close() {
    this.readyState = 3;
    this.listeners.get("close")?.({});
  }

  /** Drive the handshake the way the real socket would. */
  emitOpen() {
    this.readyState = FakeSocket.OPEN;
    this.listeners.get("open")?.({});
  }

  emitMessage(data: string) {
    this.listeners.get("message")?.({ data });
  }

  /** The real socket fires `error` and then `close` for the same failure. */
  emitErrorThenClose() {
    this.listeners.get("error")?.({});
    this.close();
  }
}

const RealWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeSocket.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
});

afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = RealWebSocket;
});

function makeSocket(apiKeys = ["key"]) {
  return new TiingoSocket({ apiKeys, onQuotes: () => {} });
}

describe("upstream connection", () => {
  test("does not dial Tiingo before a ticker is subscribed", () => {
    const upstream = makeSocket();

    upstream.connect();

    // An empty subscribe frame asks for the entire IEX feed, so no socket at
    // all is the correct behaviour here.
    expect(FakeSocket.instances).toHaveLength(0);
    expect(upstream.getStatus()).toBe("disconnected");
  });

  test("dials once a subscription exists and sends those tickers", () => {
    const upstream = makeSocket();

    upstream.setSubscriptions(["aapl", "nvda"]);
    expect(FakeSocket.instances).toHaveLength(1);

    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error("expected a socket");
    socket.emitOpen();

    expect(upstream.getStatus()).toBe("connected");
    const frame = JSON.parse(socket.sent[0] ?? "{}");
    expect(frame.eventName).toBe("subscribe");
    expect(frame.eventData.tickers).toEqual(["AAPL", "NVDA"]);
  });

  test("drops the upstream when the last subscription goes away", () => {
    const upstream = makeSocket();
    upstream.setSubscriptions(["AAPL"]);
    FakeSocket.instances[0]?.emitOpen();

    upstream.setSubscriptions([]);

    expect(upstream.getStatus()).toBe("disconnected");
    expect(FakeSocket.instances[0]?.readyState).toBe(3);
  });

  test("a rejected key rotates to the next one", async () => {
    const upstream = makeSocket(["first", "second"]);
    upstream.setSubscriptions(["AAPL"]);

    const first = FakeSocket.instances[0];
    if (!first) throw new Error("expected a socket");
    first.emitOpen();
    expect(JSON.parse(first.sent[0] ?? "{}").authorization).toBe("first");

    first.emitMessage(
      JSON.stringify({
        messageType: "E",
        response: { code: 401, message: "Not authorized" },
      }),
    );
    expect(upstream.getLastRejection()?.code).toBe(401);
    first.close();

    await Bun.sleep(400);

    const second = FakeSocket.instances[1];
    if (!second) throw new Error("expected a second socket");
    second.emitOpen();
    expect(JSON.parse(second.sent[0] ?? "{}").authorization).toBe("second");
  });

  test("keeps the socket alive with a ping, never an application frame", async () => {
    const upstream = new TiingoSocket({
      apiKeys: ["key"],
      heartbeatMs: 30,
      onQuotes: () => {},
    });
    upstream.setSubscriptions(["AAPL"]);

    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error("expected a socket");
    socket.emitOpen();
    const afterSubscribe = socket.sent.length;

    await Bun.sleep(120);

    // Tiingo closes the connection on any application frame it does not
    // recognise. The keep-alive used to be `{"eventName":"heartbeat"}`, which
    // meant the relay killed its own upstream on every beat.
    expect(socket.pings).toBeGreaterThan(0);
    expect(socket.sent.length).toBe(afterSubscribe);

    upstream.setSubscriptions([]);
  });

  test("keeps the rejection visible after the socket drops", async () => {
    const upstream = makeSocket();
    upstream.setSubscriptions(["AAPL"]);

    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error("expected a socket");
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        messageType: "E",
        response: { code: 403, message: "Not permissioned" },
      }),
    );
    socket.close();
    await Bun.sleep(20);

    // Clearing this on drop is what made /healthz report a dead upstream with
    // `lastRejection: null` — the one field that explains it.
    expect(upstream.getLastRejection()).toEqual({
      code: 403,
      message: "Not permissioned",
    });

    // Leaving it in backoff would have it dial into a later test's instance list.
    upstream.setSubscriptions([]);
  });

  test("an error followed by a close schedules one reconnect, not two", async () => {
    const upstream = makeSocket();
    upstream.setSubscriptions(["AAPL"]);

    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error("expected a socket");
    socket.emitOpen();
    const before = FakeSocket.instances.length;
    socket.emitErrorThenClose();

    // Both events used to run the reconnect path, leaking the first timer and
    // doubling the dial rate against a metered upstream.
    expect(upstream.getDiagnostics().reconnectAttempts).toBe(1);
    await Bun.sleep(1200);
    expect(FakeSocket.instances.length - before).toBe(1);

    upstream.setSubscriptions([]);
  });

  test("a socket that opens and dies immediately backs off", async () => {
    const upstream = makeSocket();
    upstream.setSubscriptions(["AAPL"]);

    // Three accept-then-drop cycles. Resetting the backoff on open made this
    // reconnect at the floor delay forever.
    for (let cycle = 0; cycle < 3; cycle++) {
      const socket = FakeSocket.instances.at(-1);
      if (!socket) throw new Error("expected a socket");
      socket.emitOpen();
      socket.close();
      await Bun.sleep(20);
    }

    // Backoff has grown past the floor, so no further socket has been opened
    // inside the short window this test waits.
    expect(FakeSocket.instances.length).toBeLessThanOrEqual(3);
  });
});
