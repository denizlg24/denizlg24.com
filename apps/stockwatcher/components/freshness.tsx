"use client";

import { useSyncExternalStore } from "react";
import { useLiveStatus, useLiveTick, useLiveTicks } from "./live-quotes";

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const day = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 5_000);
  return () => clearInterval(timer);
}
const nowKey = () => Math.floor(Date.now() / 5_000) * 5_000;
const noNow = () => 0;

const LIVE_WINDOW_MS = 120_000;
const DELAYED_WINDOW_MS = 30 * 60_000;

export type FreshnessState = "live" | "delayed" | "closed" | "unknown";

/**
 * Describes how current a quote is from its own trade time and the live feed,
 * rather than from a fixed polling interval.
 */
export function useFreshness(
  symbol: string | undefined,
  quoteMs?: number | null,
) {
  const now = useSyncExternalStore(subscribe, nowKey, noNow);
  const tick = useLiveTick(symbol);
  const status = useLiveStatus();
  const time = Math.max(tick?.time ?? 0, quoteMs ?? 0) || null;
  if (!now || time == null) return { state: "unknown" as const, time };
  const age = now - time;
  const state: FreshnessState =
    status === "live" && tick && age < LIVE_WINDOW_MS
      ? "live"
      : age < DELAYED_WINDOW_MS
        ? "delayed"
        : "closed";
  return { state, time };
}

const labels: Record<FreshnessState, string> = {
  live: "Live",
  delayed: "Delayed",
  closed: "Last trade",
  unknown: "",
};

export function Freshness({
  symbol,
  quoteMs,
}: {
  symbol?: string;
  quoteMs?: number | null;
}) {
  const { state, time } = useFreshness(symbol, quoteMs);
  if (state === "unknown" || time == null) return null;
  const date = new Date(time);
  const today = date.toDateString() === new Date().toDateString();
  return (
    <span className="freshness" data-state={state}>
      {state === "live" ? <i aria-hidden /> : null}
      {labels[state]}{" "}
      <time dateTime={date.toISOString()}>
        {today
          ? clock.format(date)
          : `${day.format(date)} ${clock.format(date)}`}
      </time>
    </span>
  );
}

/** Freshness for a list: live when any listed symbol is streaming. */
export function ListFreshness({
  symbols,
  ms,
}: {
  symbols: string[];
  ms: number | null;
}) {
  const ticks = useLiveTicks(symbols);
  let newest: string | undefined;
  let newestTime = 0;
  for (const [symbol, tick] of ticks)
    if (tick.time > newestTime) {
      newest = symbol;
      newestTime = tick.time;
    }
  if (ms == null && !newest) return null;
  return <Freshness symbol={newest} quoteMs={ms} />;
}
