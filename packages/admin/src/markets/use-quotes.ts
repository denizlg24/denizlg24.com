"use client";

import {
  type Quote,
  RELAY_HEARTBEAT_MS,
  RELAY_IDLE_TIMEOUT_MS,
  type RelayTokenResponse,
  relayServerMessageSchema,
} from "@repo/markets/schemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminApiError, type AdminClient } from "../client";
import { useAdmin } from "../provider";

export type QuoteTransport = "ws" | "poll";
export type UpstreamStatus = "connected" | "connecting" | "disconnected";

export interface QuotesState {
  quotes: Map<string, Quote>;
  transport: QuoteTransport;
  /** Tiingo's state as reported by the relay; null while polling. */
  upstream: UpstreamStatus | null;
}

const POLL_INTERVAL_MS = 20_000;
/**
 * Deliberately long. A relay that flaps would otherwise burn the Tiingo budget
 * on reconnect churn, and polling already covers the gap.
 */
const MAX_BACKOFF_MS = 300_000;
/** How long a socket must stay open before its connection counts as good. */
const STABLE_AFTER_MS = 30_000;

/**
 * Trade and quote frames each carry half the picture, so a bid-only update must
 * not erase the last traded price. Mirrors the relay's own merge.
 */
function mergeQuote(previous: Quote | undefined, next: Quote): Quote {
  if (!previous) return next;
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value !== null && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/**
 * A failed WebSocket handshake is invisible from the browser: the status code
 * is unreachable and a refused origin is indistinguishable from an unreachable
 * host — both surface as close code 1006 after a silent fall back to polling.
 * These lines are the only way to tell which happened.
 */
function log(message: string): void {
  console.info(`[markets/quotes] ${message}`);
}

function socketUrl(base: string, token: string): string {
  const url = new URL(base);
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/ws";
  url.searchParams.set("token", token);
  return url.toString();
}

function backoffMs(attempt: number): number {
  const capped = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  // Jitter keeps a fleet of tabs from reconnecting in lockstep after an outage.
  return capped / 2 + Math.random() * (capped / 2);
}

async function pollQuotes(
  client: AdminClient,
  tickers: string[],
): Promise<Quote[]> {
  const { quotes } = await client.get<{ quotes: Quote[] }>(
    `/markets/quotes?tickers=${tickers.join(",")}`,
  );
  return quotes;
}

/**
 * One interface, two transports. The relay is preferred; polling the batched
 * quotes route covers both an unconfigured relay and a socket that is down, so
 * the dashboard never depends on the socket being up.
 */
export function useQuotes(tickers: string[]): QuotesState {
  const { client } = useAdmin();
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [transport, setTransport] = useState<QuoteTransport>("poll");
  const [upstream, setUpstream] = useState<UpstreamStatus | null>(null);

  // Ticker identity, not array identity: a re-render with the same symbols must
  // not tear the socket down.
  const key = useMemo(
    () => [...new Set(tickers.map((t) => t.toUpperCase()))].sort().join(","),
    [tickers],
  );
  const wanted = useMemo(() => (key ? key.split(",") : []), [key]);

  const socketRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<string>("");
  const wantedRef = useRef<string[]>(wanted);
  const transportRef = useRef<QuoteTransport>(transport);
  wantedRef.current = wanted;
  transportRef.current = transport;

  const apply = useCallback((incoming: Quote[]) => {
    if (incoming.length === 0) return;
    setQuotes((current) => {
      const next = new Map(current);
      for (const quote of incoming) {
        next.set(quote.ticker, mergeQuote(next.get(quote.ticker), quote));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInbound = Date.now();

    const clearTimers = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (watchdog) clearInterval(watchdog);
      if (stableTimer) clearTimeout(stableTimer);
      heartbeat = null;
      watchdog = null;
      stableTimer = null;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, backoffMs(attempt++));
    };

    const connect = async (): Promise<void> => {
      if (disposed) return;

      let credentials: RelayTokenResponse;
      try {
        credentials = await client.post<RelayTokenResponse>(
          "/markets/realtime/token",
        );
      } catch (error) {
        // 503 is the route saying the relay is not configured at all. That does
        // not heal on its own, so stop and leave polling to it; anything else
        // is transient and worth another attempt.
        if (error instanceof AdminApiError && error.code === 503) {
          log(
            "relay not configured (503) — staying on polling; set MARKETS_RELAY_TOKEN_SECRET and NEXT_PUBLIC_MARKETS_RELAY_URL",
          );
          return;
        }
        log(`token mint failed: ${String(error)}`);
        if (!disposed) scheduleReconnect();
        return;
      }
      if (disposed) return;

      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl(credentials.url, credentials.token));
      } catch (error) {
        log(`could not open ${credentials.url}: ${String(error)}`);
        scheduleReconnect();
        return;
      }
      log(`connecting to ${credentials.url}`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        lastInbound = Date.now();
        setTransport("ws");
        log("socket open");
        // Backoff resets only once the socket has *held*. Resetting on open
        // makes a connection that dies immediately reconnect at the floor
        // delay forever, and every cycle costs a token mint and a poll.
        stableTimer = setTimeout(() => {
          attempt = 0;
        }, STABLE_AFTER_MS);
        if (wantedRef.current.length > 0) {
          socket.send(
            JSON.stringify({
              type: "subscribe",
              tickers: wantedRef.current,
            }),
          );
        }
        // Record it here so the resubscribe effect sees a delta, not a repeat.
        subscribedRef.current = wantedRef.current.join(",");

        // Cloudflare drops an idle WebSocket after 100 s and Tiingo goes quiet
        // outside market hours, so keep traffic on the wire either way.
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, RELAY_HEARTBEAT_MS);

        watchdog = setInterval(() => {
          if (Date.now() - lastInbound > RELAY_IDLE_TIMEOUT_MS) {
            // A half-open socket reports OPEN forever; only silence reveals it.
            socket.close();
          }
        }, RELAY_HEARTBEAT_MS);
      };

      socket.onmessage = (event) => {
        lastInbound = Date.now();
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const message = relayServerMessageSchema.safeParse(parsed);
        if (!message.success) return;

        if (message.data.type === "quotes") {
          apply(message.data.quotes);
        } else if (message.data.type === "ready") {
          setUpstream(message.data.upstream);
        } else if (message.data.type === "error") {
          // `subscribedRef` already recorded the delta as sent, so the affected
          // symbols stay empty and are never retried. Say so rather than
          // leaving a silent gap.
          log(
            `relay rejected a frame: ${message.data.code} — ${message.data.message}`,
          );
        }
      };

      socket.onclose = (event) => {
        clearTimers();
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        // 1006 with no reason is an abnormal closure — the handshake was
        // refused (bad origin, bad token) or the host was unreachable. The
        // relay's own log says which.
        const detail = event.reason
          ? `${event.code} ${event.reason}`
          : `${event.code}${event.code === 1006 ? " (handshake refused or host unreachable)" : ""}`;
        log(`socket closed: ${detail} — falling back to polling`);
        setTransport("poll");
        setUpstream(null);
        scheduleReconnect();
      };

      socket.onerror = () => socket.close();
    };

    void connect();

    return () => {
      disposed = true;
      clearTimers();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [client, apply]);

  // Resubscribe in place. The socket outlives a ticker change.
  useEffect(() => {
    const socket = socketRef.current;
    if (transport !== "ws" || socket?.readyState !== WebSocket.OPEN) {
      subscribedRef.current = "";
      return;
    }

    const previous = subscribedRef.current
      ? subscribedRef.current.split(",")
      : [];
    const added = wanted.filter((ticker) => !previous.includes(ticker));
    const removed = previous.filter((ticker) => !wanted.includes(ticker));

    if (added.length > 0) {
      socket.send(JSON.stringify({ type: "subscribe", tickers: added }));
    }
    if (removed.length > 0) {
      socket.send(JSON.stringify({ type: "unsubscribe", tickers: removed }));
    }
    subscribedRef.current = key;
  }, [key, wanted, transport]);

  // Covers the cold load and every ticker change, then keeps ticking only
  // while the socket is not delivering. Transport is read through a ref rather
  // than a dependency so a flapping socket cannot turn this into one provider
  // request per flip.
  useEffect(() => {
    if (wanted.length === 0) return;
    let cancelled = false;

    const run = () => {
      pollQuotes(client, wanted)
        .then((incoming) => {
          if (!cancelled) apply(incoming);
        })
        .catch(() => undefined);
    };

    run();

    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    // A hidden tab polls for prices nobody is reading, and browsers throttle
    // its timers anyway; coming back to it is when a stale price is most
    // visible, so that is where the immediate refetch belongs.
    const sync = () => {
      if (document.hidden) {
        stop();
        return;
      }
      run();
      if (!timer) {
        timer = setInterval(() => {
          if (transportRef.current !== "ws") run();
        }, POLL_INTERVAL_MS);
      }
    };

    timer = setInterval(() => {
      if (transportRef.current !== "ws") run();
    }, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [client, wanted, apply]);

  return { quotes, transport, upstream };
}
