import type { Quote } from "@repo/markets/schemas";

const TIINGO_IEX_URL = "wss://api.tiingo.com/iex";

/**
 * The only level this account's tier accepts. Under Tiingo's "new IEX Market
 * data rules" every level from 0 to 5 is refused with
 * `400 thresholdLevel not valid for your subscription tier`, and the socket is
 * then closed — which is what had the relay reporting `disconnected` with a
 * full subscription list. Verified against both keys with
 * `scripts/probe-keys.ts`; 6 and "omitted" are the only accepted values.
 */
export const THRESHOLD_LEVEL = 6;

/**
 * One upstream socket for the whole relay, whatever the number of browsers
 * attached. Tiingo's free tier counts connections, not subscribers, so
 * multiplexing here is the difference between working and being cut off.
 */
export interface TiingoSocketOptions {
  /** Tried in order; a rejection rotates to the next before backing off. */
  apiKeys: string[];
  onQuotes: (quotes: Quote[]) => void;
  onStatus?: (status: UpstreamStatus) => void;
  onControl?: (frame: ControlFrame) => void;
  heartbeatMs?: number;
}

/** Tiingo's own account of what it thinks of us. */
export interface ControlFrame {
  code: number;
  message: string;
}

/**
 * Anything Tiingo sends that is not market data: "I" carries the subscription
 * response, "E" an error, "H" a heartbeat.
 */
export function readControlFrame(raw: string): ControlFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const message = parsed as {
    messageType?: string;
    response?: { code?: unknown; message?: unknown };
  };
  if (message.messageType !== "I" && message.messageType !== "E") return null;

  const code = message.response?.code;
  return {
    code: typeof code === "number" ? code : 0,
    message:
      typeof message.response?.message === "string"
        ? message.response.message
        : "",
  };
}

export type UpstreamStatus = "connected" | "connecting" | "disconnected";

/**
 * The upstream is the half of the relay nobody can see. Without a line per
 * transition, "disconnected" on /healthz is indistinguishable from a bad key,
 * a connection cap, a Tiingo outage and a socket sitting in backoff.
 */
function log(message: string): void {
  console.log(`[markets-relay] ${message}`);
}

/** How long an upstream socket must hold before the connection counts as good. */
const STABLE_AFTER_MS = 30_000;

/**
 * Long on purpose. Tiingo meters connections, so a relay that reconnects hard
 * against a rejection is the thing that keeps the account exhausted.
 */
const MAX_BACKOFF_MS = 300_000;

/**
 * Field order of Tiingo's IEX "A" (trade) and "Q" (quote) messages. The feed
 * sends positional arrays, not objects, so these indices are the schema.
 */
const TRADE_TICKER = 3;
const TRADE_TIMESTAMP = 1;
const TRADE_LAST = 9;
const QUOTE_TICKER = 3;
const QUOTE_TIMESTAMP = 1;
const QUOTE_BID = 5;
const QUOTE_ASK = 7;

export class TiingoSocket {
  private socket: WebSocket | null = null;
  private status: UpstreamStatus = "disconnected";
  private subscribed = new Set<string>();
  private reconnectAttempts = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private keyIndex = 0;
  /** Key the current rejection pass started on; null when no pass is running. */
  private passStartKeyIndex: number | null = null;
  private lastRejection: ControlFrame | null = null;
  /** Cleared once acted on; `lastRejection` is kept for `/healthz`. */
  private pendingRejection: ControlFrame | null = null;
  private nextReconnectAt: number | null = null;

  constructor(private readonly options: TiingoSocketOptions) {
    if (options.apiKeys.length === 0) {
      throw new Error("At least one Tiingo API key is required");
    }
  }

  getStatus(): UpstreamStatus {
    return this.status;
  }

  /**
   * Whatever Tiingo last refused us with, for `/healthz`. Deliberately sticky:
   * this used to be cleared on every drop, which meant the one field that
   * explains a dead upstream was always null by the time anyone looked.
   */
  getLastRejection(): ControlFrame | null {
    return this.lastRejection;
  }

  /** Which key the current or next attempt uses, and when that attempt lands. */
  getDiagnostics(): {
    keyIndex: number;
    keyCount: number;
    reconnectAttempts: number;
    retryInMs: number | null;
  } {
    return {
      keyIndex: this.keyIndex,
      keyCount: this.options.apiKeys.length,
      reconnectAttempts: this.reconnectAttempts,
      retryInMs:
        this.nextReconnectAt === null
          ? null
          : Math.max(0, this.nextReconnectAt - Date.now()),
    };
  }

  private get apiKey(): string {
    return this.options.apiKeys[this.keyIndex] ?? "";
  }

  /**
   * Moves to the next key. Tiingo meters concurrent connections and requests
   * per key, so a rejection on one is worth retrying on another before backing
   * off — but only once around the ring, or a dead plan becomes a spin.
   *
   * The ring boundary is the key the pass started on, not index 0. The index
   * survives reconnects, so anchoring on 0 would stop the pass early and back
   * off on a key Tiingo has already refused while never trying the rest.
   */
  private rotateKey(): boolean {
    if (this.options.apiKeys.length < 2) return false;
    if (this.passStartKeyIndex === null) this.passStartKeyIndex = this.keyIndex;
    this.keyIndex = (this.keyIndex + 1) % this.options.apiKeys.length;
    if (this.keyIndex === this.passStartKeyIndex) {
      this.passStartKeyIndex = null;
      return false;
    }
    return true;
  }

  /** Never the key itself — these end up in journald. */
  private get keyLabel(): string {
    return `key ${this.keyIndex + 1}/${this.options.apiKeys.length}`;
  }

  /**
   * Revives a socket that `close()` shut down. The last client leaving tears
   * the upstream down to stop paying for an idle connection, and the next one
   * arriving has to be able to bring it back.
   */
  connect(): void {
    this.closed = false;
    if (this.socket) return;
    // A subscribe frame with no tickers asks Tiingo for the whole IEX feed,
    // which the free tier answers by dropping the connection. Wait for a
    // symbol instead of opening a socket that can only be wrong.
    if (this.subscribed.size === 0) return;
    // A subscription arriving mid-backoff dials now; the pending timer would
    // otherwise fire later and be a no-op, or race a teardown.
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.nextReconnectAt = null;
    this.setStatus("connecting");
    log(
      `upstream dialling ${TIINGO_IEX_URL} with ${this.keyLabel} for ${this.subscribed.size} ticker(s)`,
    );

    const socket = new WebSocket(TIINGO_IEX_URL);
    this.socket = socket;
    // `error` is followed by `close`, and handling both scheduled two
    // reconnects and leaked the first timer. One drop per socket.
    let dropped = false;
    const drop = (why: string) => {
      if (dropped) return;
      dropped = true;
      this.handleDrop(why);
    };

    socket.addEventListener("open", () => {
      this.setStatus("connected");
      log(`upstream open with ${this.keyLabel}`);
      this.send({
        eventName: "subscribe",
        authorization: this.apiKey,
        eventData: {
          thresholdLevel: THRESHOLD_LEVEL,
          tickers: [...this.subscribed],
        },
      });
      this.startHeartbeat();

      // Backoff resets only once the socket has held. Resetting it here made a
      // connection Tiingo accepts and then drops — a rejected subscribe, or the
      // connection cap — reconnect at the floor delay forever.
      this.stableTimer = setTimeout(() => {
        this.reconnectAttempts = 0;
        // A key that has held is a fresh starting point for the next pass.
        this.passStartKeyIndex = null;
      }, STABLE_AFTER_MS);
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", (event) => {
      const { code, reason } = event as CloseEvent;
      drop(`closed ${code}${reason ? ` ${reason}` : ""}`);
    });
    socket.addEventListener("error", () => drop("socket error"));
  }

  close(): void {
    if (this.socket) log("upstream torn down — no subscribers left");
    this.closed = true;
    this.nextReconnectAt = null;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.reconnectTimer = null;
    this.stableTimer = null;
    this.socket?.close();
    this.socket = null;
    this.setStatus("disconnected");
  }

  setSubscriptions(tickers: string[]): void {
    const next = new Set(tickers.map((ticker) => ticker.toUpperCase()));
    const added = [...next].filter((ticker) => !this.subscribed.has(ticker));
    const removed = [...this.subscribed].filter((ticker) => !next.has(ticker));
    this.subscribed = next;

    // The subscription set decides whether an upstream should exist at all.
    if (next.size === 0) {
      this.close();
      return;
    }
    if (!this.socket) {
      this.connect();
      return;
    }

    if (this.status !== "connected") return;
    if (added.length > 0) {
      this.send({
        eventName: "subscribe",
        authorization: this.apiKey,
        eventData: { thresholdLevel: THRESHOLD_LEVEL, tickers: added },
      });
    }
    if (removed.length > 0) {
      this.send({
        eventName: "unsubscribe",
        authorization: this.apiKey,
        eventData: { tickers: removed },
      });
    }
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private setStatus(status: UpstreamStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  /**
   * Cloudflare drops an idle WebSocket after 100 s and Tiingo goes quiet
   * outside market hours, so the connection has to generate its own traffic.
   *
   * It has to be a protocol-level ping. This used to send an application frame,
   * `{"eventName":"heartbeat"}`, which Tiingo answers with
   * `400 Data was not valid json` and *then closes the socket* — so the
   * keep-alive was tearing the upstream down on every single beat, which is
   * what kept the relay in a connect/die/back-off cycle. A ping instead holds
   * the socket open indefinitely and draws no response at all; Tiingo's own
   * "H" frames come back the other way.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const socket = this.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.ping();
    }, this.options.heartbeatMs ?? 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private handleDrop(why: string): void {
    this.stopHeartbeat();
    if (this.stableTimer) clearTimeout(this.stableTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stableTimer = null;
    this.reconnectTimer = null;
    this.socket = null;
    this.setStatus("disconnected");
    log(`upstream dropped on ${this.keyLabel}: ${why}`);

    if (this.closed || this.subscribed.size === 0) {
      this.nextReconnectAt = null;
      return;
    }

    const rejection = this.pendingRejection;
    this.pendingRejection = null;

    // A rejected key is worth retrying immediately on a different one; the same
    // key will only be rejected again. Once the ring is exhausted, back off.
    // 400 is excluded: it means the frame was wrong, not the key, so rotating
    // just burns the whole ring on a bug every other key shares.
    if (rejection && rejection.code !== 400 && this.rotateKey()) {
      log(
        `rotating after ${rejection.code} ${rejection.message} — retrying on ${this.keyLabel}`,
      );
      this.scheduleReconnect(250);
      return;
    }

    // Exponential backoff with jitter: a Tiingo-side outage otherwise has every
    // restarted relay reconnecting in lockstep.
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.reconnectAttempts);
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 8);
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delay: number): void {
    this.nextReconnectAt = Date.now() + delay;
    log(
      `reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;

    // Tiingo reports a bad key, a revoked plan or an exhausted limit as an "E"
    // or a non-200 "I" frame and then closes. Swallowing those turned every
    // rejection into an unexplained reconnect loop.
    const control = readControlFrame(raw);
    if (control) {
      this.options.onControl?.(control);
      if (control.code !== 200) {
        this.lastRejection = control;
        this.pendingRejection = control;
      }
      return;
    }

    const quote = parseIexMessage(raw);
    if (quote) this.options.onQuotes([quote]);
  }
}

/**
 * Tiingo's IEX feed sends positional arrays rather than objects, so the index
 * constants above *are* the schema. Exported for the tests, which are the only
 * thing standing between a silent field-order change and a chart of nonsense.
 */
export function parseIexMessage(raw: string): Quote | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const message = parsed as { messageType?: string; data?: unknown[] };
  if (message.messageType !== "A" || !Array.isArray(message.data)) return null;

  const row = message.data;
  return row[0] === "T" ? readTrade(row) : readQuote(row);
}

function readTrade(row: unknown[]): Quote | null {
  const ticker = row[TRADE_TICKER];
  const last = row[TRADE_LAST];
  if (typeof ticker !== "string" || typeof last !== "number") return null;
  return {
    ticker: ticker.toUpperCase(),
    last,
    prevClose: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    bid: null,
    ask: null,
    ts: readTimestamp(row[TRADE_TIMESTAMP]),
    source: "ws",
  };
}

function readQuote(row: unknown[]): Quote | null {
  const ticker = row[QUOTE_TICKER];
  if (typeof ticker !== "string") return null;
  const bid = row[QUOTE_BID];
  const ask = row[QUOTE_ASK];
  if (typeof bid !== "number" && typeof ask !== "number") return null;
  return {
    ticker: ticker.toUpperCase(),
    last: null,
    prevClose: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    bid: typeof bid === "number" ? bid : null,
    ask: typeof ask === "number" ? ask : null,
    ts: readTimestamp(row[QUOTE_TIMESTAMP]),
    source: "ws",
  };
}

function readTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}
