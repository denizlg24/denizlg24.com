import { timingSafeEqual } from "node:crypto";
import { verifyRelayToken } from "@repo/markets/core";
import {
  type Quote,
  RELAY_MAX_SYMBOLS,
  type RelayServerMessage,
  relayClientMessageSchema,
} from "@repo/markets/schemas";
import type { Server, ServerWebSocket } from "bun";
import { type UpstreamStatus, YahooStream } from "./yahoo-stream";

function log(message: string): void {
  console.log(`[markets-relay] ${message}`);
}

const tokenSecret = requireEnv("MARKETS_RELAY_TOKEN_SECRET");
const dataToken = process.env.MARKETS_DATA_TOKEN || tokenSecret;
const workerPort = process.env.MARKETS_WORKER_PORT ?? "3014";
const workerUrl = `http://127.0.0.1:${workerPort}`;
const python =
  process.env.MARKETS_PYTHON ??
  new URL("../python/.venv/bin/python", import.meta.url).pathname;
const workerDir =
  process.env.MARKETS_WORKER_DIR ??
  new URL("../python/", import.meta.url).pathname;
let stopping = false;
const worker = Bun.spawn({
  cmd: [
    python,
    "-m",
    "uvicorn",
    "worker:app",
    "--host",
    "127.0.0.1",
    "--port",
    workerPort,
    "--no-access-log",
    "--ws-max-size",
    "8192",
    "--timeout-graceful-shutdown",
    "5",
  ],
  cwd: workerDir,
  env: { ...process.env, XDG_CACHE_HOME: "/tmp/markets-cache" },
  stdout: "inherit",
  stderr: "inherit",
  onExit: (_process, code) => process.exit(stopping ? 0 : code || 1),
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    worker.kill(signal);
  });
}

const port = Number(process.env.PORT ?? 3004);
const allowedOrigins = (process.env.MARKETS_RELAY_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

log(
  `starting Yahoo Finance and FRED; origins: ${
    allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "(any)"
  }`,
);
if (allowedOrigins.length === 0) {
  // A deployment that loses the variable degrades to any-origin silently; the
  // relay token is then the only gate left.
  log(
    "WARNING: MARKETS_RELAY_ALLOWED_ORIGINS is unset — every origin is accepted",
  );
}

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

const upstream = new YahooStream(
  `ws://127.0.0.1:${workerPort}/internal/stream`,
  (quotes) => {
    for (const quote of quotes) {
      const previous = pending.get(quote.ticker);
      if (previous && Date.parse(previous.ts) > Date.parse(quote.ts)) continue;
      pending.set(quote.ticker, previous ? mergeQuote(previous, quote) : quote);
    }
  },
  broadcastStatus,
);

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

function subscriptionUnion(
  replacement?: ClientState,
  tickers?: Set<string>,
): Set<string> {
  const union = new Set<string>();
  for (const state of clients.values()) {
    for (const ticker of state === replacement && tickers
      ? tickers
      : state.tickers) {
      union.add(ticker);
    }
  }
  return union;
}

function authorized(request: Request): boolean {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${dataToken}`);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

async function dataResponse(url: URL, signal: AbortSignal): Promise<Response> {
  try {
    const response = await fetch(workerUrl + url.pathname + url.search, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      redirect: "error",
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { detail: "Markets worker unavailable" },
      { status: 503 },
    );
  }
}

function resyncUpstream(): void {
  upstream.setSubscriptions([...subscriptionUnion()].sort());
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
      const healthy = await fetch(`${workerUrl}/healthz`, {
        signal: AbortSignal.timeout(1000),
      })
        .then((response) => response.ok)
        .catch(() => false);
      return Response.json(
        {
          status: healthy ? "ok" : "unavailable",
          upstream: upstream.getStatus(),
          providers: ["yahoo", "fred"],
          clients: clients.size,
          subscriptions: subscriptionUnion().size,
          version: process.env.APP_VERSION ?? "dev",
        },
        { status: healthy ? 200 : 503 },
      );
    }

    if (url.pathname.startsWith("/v1/")) {
      if (!authorized(request)) {
        return Response.json({ detail: "Unauthorized" }, { status: 401 });
      }
      if (request.method !== "GET") {
        return Response.json(
          { detail: "Method not allowed" },
          {
            status: 405,
            headers: { Allow: "GET" },
          },
        );
      }
      return dataResponse(url, request.signal);
    }

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    const origin = request.headers.get("origin");
    if (
      allowedOrigins.length > 0 &&
      origin &&
      !allowedOrigins.includes(origin)
    ) {
      // Logged because the failure is otherwise invisible: the client sees a
      // socket that will not open and silently falls back to polling. Tauri in
      // particular sends an origin that varies by platform.
      log(`handshake refused: origin ${origin} not allowed`);
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
    // The top-level `idleTimeout` governs HTTP requests, not open sockets. The
    // relay only broadcasts on a new quote, so a client watching a quiet symbol
    // would be closed by Bun's default WebSocket idle timeout.
    idleTimeout: 0,
    maxPayloadLength: 8192,

    open(socket: ServerWebSocket<ClientState>) {
      clients.set(socket, socket.data);
      log(`client connected (${clients.size} total)`);
      send(socket, {
        type: "ready",
        tickers: [],
        upstream: upstream.getStatus(),
      });
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
        // Checked against a copy first. Committing the additions and only then
        // rejecting would leave the client over the cap for the life of the
        // connection, and any later resync would send that union upstream.
        const next = new Set(socket.data.tickers);
        for (const ticker of message.data.tickers) {
          next.add(ticker.toUpperCase());
        }
        if (subscriptionUnion(socket.data, next).size > RELAY_MAX_SYMBOLS) {
          send(socket, {
            type: "error",
            code: "too_many_symbols",
            message: `The relay supports up to ${RELAY_MAX_SYMBOLS} distinct symbols at once`,
          });
          return;
        }
        socket.data.tickers = next;
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
