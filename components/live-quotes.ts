"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

export type LiveStatus = "off" | "connecting" | "live" | "idle";
export type LiveTick = {
  last: number;
  previous: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  time: number;
};

const relayTicker = /^(?=.*[A-Z0-9])[A-Z0-9.^=\-:]{1,24}$/;
const price = z.number().positive().nullable();
const relayQuote = z.object({
  ticker: z.string(),
  last: price,
  prevClose: price,
  open: price,
  high: price,
  low: price,
  volume: z.number().nonnegative().nullable(),
  ts: z.string(),
});
const serverMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    upstream: z.enum(["connected", "connecting", "disconnected"]),
  }),
  z.object({ type: z.literal("quotes"), quotes: z.array(relayQuote) }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
const credentials = z.object({ token: z.string(), url: z.string() });

const HEARTBEAT_MS = 30_000;
const IDLE_TIMEOUT_MS = 90_000;
const STABLE_AFTER_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;
const MAX_SYMBOLS = 200;

const counts = new Map<string, number>();
const ticks = new Map<string, LiveTick>();
const listeners = new Set<() => void>();
let status: LiveStatus = "off";
let socket: WebSocket | null = null;
let subscribed = new Set<string>();
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
let disabled = false;
let version = 0;
type Snapshot = {
  version: number;
  status: LiveStatus;
  ticks: Map<string, LiveTick>;
};
let snapshot: Snapshot = { version, status, ticks };

function emit() {
  version++;
  snapshot = { version, status, ticks };
  for (const listener of listeners) listener();
}

function setStatus(next: LiveStatus) {
  if (status === next) return;
  status = next;
  emit();
}

function wanted() {
  return [...counts.keys()].slice(0, MAX_SYMBOLS);
}

function send(message: object) {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
}

function sync() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const next = new Set(wanted());
  const added = [...next].filter((symbol) => !subscribed.has(symbol));
  const removed = [...subscribed].filter((symbol) => !next.has(symbol));
  if (removed.length) send({ type: "unsubscribe", tickers: removed });
  if (added.length) send({ type: "subscribe", tickers: added });
  subscribed = next;
}

function clearTimers() {
  if (heartbeat) clearInterval(heartbeat);
  if (stableTimer) clearTimeout(stableTimer);
  heartbeat = null;
  stableTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer || disabled || counts.size === 0) return;
  const capped = Math.min(1000 * 2 ** attempt++, MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(
    () => {
      reconnectTimer = null;
      void connect();
    },
    capped / 2 + Math.random() * (capped / 2),
  );
}

function apply(quotes: z.infer<typeof relayQuote>[]) {
  let changed = false;
  for (const quote of quotes) {
    const prior = ticks.get(quote.ticker);
    const time = Date.parse(quote.ts);
    if (!Number.isFinite(time) || (prior && time < prior.time)) continue;
    const last = quote.last ?? prior?.last;
    if (last == null) continue;
    ticks.set(quote.ticker, {
      last,
      previous: quote.prevClose ?? prior?.previous ?? null,
      open: quote.open ?? prior?.open ?? null,
      high: quote.high ?? prior?.high ?? null,
      low: quote.low ?? prior?.low ?? null,
      volume: quote.volume ?? prior?.volume ?? null,
      time,
    });
    changed = true;
  }
  if (changed) emit();
}

async function connect() {
  if (socket || disabled || counts.size === 0) return;
  setStatus("connecting");
  let target: string;
  try {
    const response = await fetch("/api/market/stream", { method: "POST" });
    if (response.status === 503) {
      disabled = true;
      setStatus("off");
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { token, url } = credentials.parse(await response.json());
    const address = new URL(url);
    if (address.pathname === "" || address.pathname === "/")
      address.pathname = "/ws";
    address.protocol = address.protocol === "http:" ? "ws:" : "wss:";
    address.searchParams.set("token", token);
    target = address.toString();
  } catch {
    setStatus("off");
    scheduleReconnect();
    return;
  }
  if (socket || counts.size === 0) return;

  const current = new WebSocket(target);
  socket = current;
  let lastInbound = Date.now();
  current.onopen = () => {
    if (socket !== current) return current.close();
    lastInbound = Date.now();
    subscribed = new Set();
    sync();
    stableTimer = setTimeout(() => {
      attempt = 0;
    }, STABLE_AFTER_MS);
    heartbeat = setInterval(() => {
      if (Date.now() - lastInbound > IDLE_TIMEOUT_MS) current.close();
      else send({ type: "ping" });
    }, HEARTBEAT_MS);
  };
  current.onmessage = (event) => {
    if (socket !== current) return;
    lastInbound = Date.now();
    let payload: unknown;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const message = serverMessage.safeParse(payload);
    if (!message.success) return;
    if (message.data.type === "quotes") apply(message.data.quotes);
    else if (message.data.type === "ready")
      setStatus(message.data.upstream === "connected" ? "live" : "idle");
  };
  current.onerror = () => current.close();
  current.onclose = () => {
    if (socket !== current) return;
    socket = null;
    subscribed = new Set();
    clearTimers();
    setStatus(counts.size ? "connecting" : "off");
    scheduleReconnect();
  };
}

function retain(symbols: string[]) {
  for (const symbol of symbols)
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  if (socket) sync();
  else if (!reconnectTimer) void connect();
}

function release(symbols: string[]) {
  for (const symbol of symbols) {
    const count = (counts.get(symbol) ?? 0) - 1;
    if (count > 0) counts.set(symbol, count);
    else counts.delete(symbol);
  }
  if (counts.size === 0) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearTimers();
    const closing = socket;
    socket = null;
    subscribed = new Set();
    closing?.close();
    setStatus("off");
  } else sync();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => snapshot;
const serverSnapshot: Snapshot = { version: 0, status: "off", ticks };
const getServerSnapshot = () => serverSnapshot;

export function useLiveStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).status;
}

export function useLiveTicks(symbols: string[]) {
  const key = [...new Set(symbols)]
    .filter((symbol) => relayTicker.test(symbol))
    .sort()
    .join(",");
  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    retain(list);
    return () => release(list);
  }, [key]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    const result = new Map<string, LiveTick>();
    if (!key) return result;
    for (const symbol of key.split(",")) {
      const tick = state.ticks.get(symbol);
      if (tick) result.set(symbol, tick);
    }
    return result;
  }, [key, state]);
}
