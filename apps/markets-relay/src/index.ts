import { verifyRelayToken } from "@repo/markets/core";
import {
  type Quote,
  RELAY_HEARTBEAT_MS,
  RELAY_MAX_SYMBOLS,
  type RelayServerMessage,
  relayClientMessageSchema,
} from "@repo/markets/schemas";
import type { Server, ServerWebSocket } from "bun";
import { TiingoSocket, type UpstreamStatus } from "./tiingo-socket";

/**
 * Tiingo meters per key, so more keys is more headroom. Numbered suffixes are
 * read until one is missing: TIINGO_API_KEY, TIINGO_API_KEY_2, _3, …
 */
function readApiKeys(): string[] {
  const keys = [requireEnv("TIINGO_API_KEY")];
  for (let index = 2; ; index++) {
    const key = process.env[`TIINGO_API_KEY_${index}`]?.trim();
    if (!key) break;
    keys.push(key);
  }
  return keys;
}

function log(message: string): void {
  console.log(`[markets-relay] ${message}`);
}

const apiKeys = readApiKeys();
const tokenSecret = requireEnv("MARKETS_RELAY_TOKEN_SECRET");
const port = Number(process.env.PORT ?? 3004);
const allowedOrigins = (process.env.MARKETS_RELAY_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

log(
  `starting with ${apiKeys.length} Tiingo key(s); origins: ${
    allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "(any)"
  }`,
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface ClientState {
  tickers: Set<string>;
}

const clients = new Map<ServerWebSocket<ClientState>, ClientState>();

/**
 * Quotes are buffered and flushed on a tick rather than forwarded one by one.
 * A liquid symbol can print hundreds of times a second, and every forwarded
 * frame is a React render on the other end.
 */
const pending = new Map<string, Quote>();

const upstream = new TiingoSocket({
  apiKeys,
  heartbeatMs: RELAY_HEARTBEAT_MS,
  onControl: (frame) => {
    // The one place Tiingo explains itself. Without this a rejected key is
    // indistinguishable from a network blip.
    const label = frame.code === 200 ? "info" : "rejected";
    log(`upstream ${label}: ${frame.code} ${frame.message}`);
  },
  onQuotes: (quotes) => {
    for (const quote of quotes) {
      const previous = pending.get(quote.ticker);
      // Trade and quote messages carry different halves of the picture, so
      // merge rather than letting a bid-only update erase the last price.
      pending.set(quote.ticker, previous ? mergeQuote(previous, quote) : quote);
    }
  },
  onStatus: (status) => broadcastStatus(status),
});

function mergeQuote(previous: Quote, next: Quote): Quote {
  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== null),
    ),
    ticker: next.ticker,
    ts: next.ts,
    source: "ws",
  } as Quote;
}

setInterval(() => {
  if (pending.size === 0) return;
  const batch = [...pending.values()];
  pending.clear();

  for (const [socket, state] of clients) {
    const relevant = batch.filter((quote) => state.tickers.has(quote.ticker));
    if (relevant.length === 0) continue;
    send(socket, { type: "quotes", quotes: relevant });
  }
}, 250);

function send(
  socket: ServerWebSocket<ClientState>,
  message: RelayServerMessage,
): void {
  socket.send(JSON.stringify(message));
}

function broadcastStatus(status: UpstreamStatus): void {
  for (const [socket, state] of clients) {
    send(socket, {
      type: "ready",
      tickers: [...state.tickers],
      upstream: status,
    });
  }
}

/**
 * The upstream subscription is the union of what every client wants, and that
 * union is also what decides whether an upstream should exist — an empty one
 * means nobody is listening, so there is nothing to pay Tiingo for.
 */
function subscriptionCount(): number {
  const union = new Set<string>();
  for (const state of clients.values()) {
    for (const ticker of state.tickers) union.add(ticker);
  }
  return union.size;
}

function resyncUpstream(): void {
  const union = new Set<string>();
  for (const state of clients.values()) {
    for (const ticker of state.tickers) union.add(ticker);
  }
  upstream.setSubscriptions([...union]);
}

const server = Bun.serve({
  port,
  idleTimeout: 0,

  async fetch(
    request: Request,
    server: Server<ClientState>,
  ): Promise<Response | undefined> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({
        status: "ok",
        upstream: upstream.getStatus(),
        clients: clients.size,
        keys: apiKeys.length,
        subscriptions: subscriptionCount(),
        lastRejection: upstream.getLastRejection(),
        ...upstream.getDiagnostics(),
        version: process.env.APP_VERSION ?? "dev",
      });
    }

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    const origin = request.headers.get("origin");
    if (
      allowedOrigins.length > 0 &&
      (!origin || !allowedOrigins.includes(origin))
    ) {
      // Logged because the failure is otherwise invisible: the client sees a
      // socket that will not open and silently falls back to polling. Tauri in
      // particular sends an origin that varies by platform.
      log(`handshake refused: origin ${origin ?? "(none)"} not allowed`);
      return new Response("Forbidden origin", { status: 403 });
    }

    // The token rides in the query string because browsers cannot set headers
    // on a WebSocket handshake. It is short-lived and grants nothing else.
    const token = url.searchParams.get("token");
    if (!token) {
      log(`handshake refused: no token (origin ${origin ?? "(none)"})`);
      return new Response("Missing token", { status: 401 });
    }

    const verdict = await verifyRelayToken(token, tokenSecret);
    if (!verdict.ok) {
      log(`handshake refused: token ${verdict.reason}`);
      return new Response(`Invalid token: ${verdict.reason}`, { status: 401 });
    }

    if (server.upgrade(request, { data: { tickers: new Set<string>() } })) {
      return undefined;
    }
    return new Response("Upgrade failed", { status: 400 });
  },

  websocket: {
    open(socket: ServerWebSocket<ClientState>) {
      clients.set(socket, socket.data);
      log(`client connected (${clients.size} total)`);
      send(socket, {
        type: "ready",
        tickers: [],
        upstream: upstream.getStatus(),
      });
      // No upstream yet: this client has not said what it wants, and dialling
      // Tiingo with an empty subscription asks for the entire IEX feed.
    },

    message(socket: ServerWebSocket<ClientState>, raw: string | Buffer) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        send(socket, {
          type: "error",
          code: "bad_request",
          message: "Malformed frame",
        });
        return;
      }

      const message = relayClientMessageSchema.safeParse(parsed);
      if (!message.success) {
        send(socket, {
          type: "error",
          code: "bad_request",
          message: "Unrecognised message",
        });
        return;
      }

      if (message.data.type === "ping") {
        send(socket, { type: "pong", ts: new Date().toISOString() });
        return;
      }

      if (message.data.type === "subscribe") {
        for (const ticker of message.data.tickers) {
          socket.data.tickers.add(ticker.toUpperCase());
        }
        if (socket.data.tickers.size > RELAY_MAX_SYMBOLS) {
          send(socket, {
            type: "error",
            code: "too_many_symbols",
            message: `At most ${RELAY_MAX_SYMBOLS} symbols`,
          });
          return;
        }
      } else {
        for (const ticker of message.data.tickers) {
          socket.data.tickers.delete(ticker.toUpperCase());
        }
      }

      resyncUpstream();
      send(socket, {
        type: "ready",
        tickers: [...socket.data.tickers],
        upstream: upstream.getStatus(),
      });
    },

    close(socket: ServerWebSocket<ClientState>) {
      clients.delete(socket);
      log(`client disconnected (${clients.size} left)`);
      // Drops the upstream too when this was the last subscriber.
      resyncUpstream();
    },
  },
});

console.log(`[markets-relay] listening on ${server.hostname}:${server.port}`);
