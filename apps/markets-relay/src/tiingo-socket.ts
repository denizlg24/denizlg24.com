import type { Quote } from "@repo/markets/schemas";

const TIINGO_IEX_URL = "wss://api.tiingo.com/iex";

/**
 * One upstream socket for the whole relay, whatever the number of browsers
 * attached. Tiingo's free tier counts connections, not subscribers, so
 * multiplexing here is the difference between working and being cut off.
 */
export interface TiingoSocketOptions {
  apiKey: string;
  onQuotes: (quotes: Quote[]) => void;
  onStatus?: (status: UpstreamStatus) => void;
  heartbeatMs?: number;
}

export type UpstreamStatus = "connected" | "connecting" | "disconnected";

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
  private closed = false;

  constructor(private readonly options: TiingoSocketOptions) {}

  getStatus(): UpstreamStatus {
    return this.status;
  }

  /**
   * Revives a socket that `close()` shut down. The last client leaving tears
   * the upstream down to stop paying for an idle connection, and the next one
   * arriving has to be able to bring it back.
   */
  connect(): void {
    this.closed = false;
    if (this.socket) return;
    this.setStatus("connecting");

    const socket = new WebSocket(TIINGO_IEX_URL);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.send({
        eventName: "subscribe",
        authorization: this.options.apiKey,
        eventData: {
          thresholdLevel: 5,
          tickers: [...this.subscribed],
        },
      });
      this.startHeartbeat();
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => this.handleDrop());
    socket.addEventListener("error", () => this.handleDrop());
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  setSubscriptions(tickers: string[]): void {
    const next = new Set(tickers.map((ticker) => ticker.toUpperCase()));
    const added = [...next].filter((ticker) => !this.subscribed.has(ticker));
    const removed = [...this.subscribed].filter((ticker) => !next.has(ticker));
    this.subscribed = next;

    if (this.status !== "connected") return;
    if (added.length > 0) {
      this.send({
        eventName: "subscribe",
        authorization: this.options.apiKey,
        eventData: { thresholdLevel: 5, tickers: added },
      });
    }
    if (removed.length > 0) {
      this.send({
        eventName: "unsubscribe",
        authorization: this.options.apiKey,
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
   * Cloudflare drops an idle WebSocket after 100 s and Tiingo says nothing at
   * all outside market hours, so the connection has to generate its own
   * traffic or it dies every couple of minutes overnight.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send({ eventName: "heartbeat" });
      }
    }, this.options.heartbeatMs ?? 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private handleDrop(): void {
    this.stopHeartbeat();
    this.socket = null;
    this.setStatus("disconnected");
    if (this.closed) return;

    // Exponential backoff with jitter: a Tiingo-side outage otherwise has every
    // restarted relay reconnecting in lockstep.
    const base = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 5);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
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
