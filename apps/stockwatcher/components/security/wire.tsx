"use client";

import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { api, Empty, Failure, Loading } from "@/components/shared";
import type { WireItem } from "@/lib/market";
import type { Workspace } from "@/lib/models";
import { symbolPattern } from "@/lib/universes";

type Source = "watchlists" | "positions" | "trending" | "custom";
const sources: [Source, string][] = [
  ["watchlists", "Watchlists"],
  ["positions", "Positions"],
  ["trending", "Trending"],
  ["custom", "Custom"],
];

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayLabel = (time: number) => {
  const date = new Date(time * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
};
const ago = (time: number) => {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - time) / 60));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

export function NewsWire({
  watchlists,
  trades,
  initial,
  select,
}: {
  watchlists: Workspace["watchlists"];
  trades: Workspace["trades"];
  initial?: string[];
  select: (symbol: string) => void;
}) {
  const [source, setSource] = useState<Source>(
    initial?.length ? "custom" : watchlists.length ? "watchlists" : "trending",
  );
  const [custom, setCustom] = useState<string[]>(initial ?? []);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    previous: Set<string> | null;
    current: Set<string> | null;
  }>({
    previous: null,
    current: null,
  });
  const symbols = useMemo(() => {
    if (source === "watchlists")
      return [...new Set(watchlists.flatMap((list) => list.symbols))].slice(
        0,
        40,
      );
    if (source === "positions")
      return [...new Set(trades.map((trade) => trade.symbol))].slice(0, 40);
    if (source === "custom") return custom;
    return [];
  }, [source, watchlists, trades, custom]);
  const key =
    source === "trending" || symbols.length
      ? `/api/wire?${new URLSearchParams({ symbols: symbols.join(",") })}`
      : null;
  const { data, error, isLoading, mutate } = useSWR<{
    items: WireItem[];
    trending: string[];
    symbols: string[];
  }>(key, api, {
    refreshInterval: 120_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
    onSuccess: (result) =>
      setSnapshot((prior) => ({
        previous: prior.current,
        current: new Set(result.items.map((item) => item.id)),
      })),
  });
  const fresh = useMemo(() => {
    const { previous, current } = snapshot;
    if (!previous || !current) return new Set<string>();
    return new Set([...current].filter((id) => !previous.has(id)));
  }, [snapshot]);
  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const item of data?.items ?? [])
      for (const symbol of item.symbols)
        tally.set(symbol, (tally.get(symbol) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const needle = query.trim().toLowerCase();
  const items = (data?.items ?? []).filter(
    (item) =>
      (!only || item.symbols.includes(only)) &&
      (!needle ||
        item.title.toLowerCase().includes(needle) ||
        item.publisher.toLowerCase().includes(needle)),
  );

  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <div className="seg" role="group" aria-label="News source">
            {sources.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={source === key}
                onClick={() => setSource(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {source === "custom" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const added = text
                  .toUpperCase()
                  .split(/[\s,]+/)
                  .filter((item) => symbolPattern.test(item));
                setCustom([...new Set([...custom, ...added])].slice(0, 40));
                setText("");
              }}
            >
              <input
                className="studio-select"
                placeholder="Add tickers"
                value={text}
                onChange={(event) => setText(event.target.value.toUpperCase())}
                aria-label="Add tickers"
              />
            </form>
          ) : null}
          <input
            className="studio-select"
            placeholder="Filter headlines"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter headlines"
          />
        </div>
        <span className="term-source">
          {items.length} stories · refreshes every 2 minutes
          {fresh.size ? ` · ${fresh.size} new` : ""}
        </span>
      </div>
      {counts.length ? (
        <div
          className="wire-symbols"
          role="group"
          aria-label="Filter by symbol"
        >
          {only ? (
            <button
              type="button"
              className="chip"
              onClick={() => setOnly(null)}
            >
              All
            </button>
          ) : null}
          {counts.slice(0, 30).map(([symbol, count]) => (
            <button
              key={symbol}
              type="button"
              className="chip"
              aria-pressed={only === symbol}
              onClick={() => setOnly(only === symbol ? null : symbol)}
            >
              {symbol} <small>{count}</small>
            </button>
          ))}
        </div>
      ) : null}
      {source === "custom" && !custom.length ? (
        <Empty title="Add tickers to follow" />
      ) : source !== "trending" && !symbols.length ? (
        <Empty
          title={
            source === "watchlists" ? "No watchlist symbols" : "No positions"
          }
        />
      ) : error ? (
        <Failure error={error} retry={() => void mutate()} />
      ) : isLoading && !data ? (
        <Loading message="Loading headlines" />
      ) : !items.length ? (
        <Empty title="No stories" />
      ) : (
        <ol className="wire">
          {items.map((item, index) => {
            const label = dayLabel(item.time);
            const header =
              index === 0 || dayLabel(items[index - 1].time) !== label
                ? label
                : null;
            return (
              <li key={item.id} data-fresh={fresh.has(item.id) || undefined}>
                {header ? <h3 className="wire-day">{header}</h3> : null}
                <div className="wire-row">
                  <time
                    dateTime={new Date(item.time * 1000).toISOString()}
                    title={new Date(item.time * 1000).toLocaleString()}
                  >
                    {clock.format(item.time * 1000)}
                    <small>{ago(item.time)}</small>
                  </time>
                  <span className="wire-tickers">
                    {item.symbols.slice(0, 4).map((symbol) => (
                      <button
                        key={symbol}
                        type="button"
                        className="security-link"
                        onClick={() => select(symbol)}
                      >
                        {symbol}
                      </button>
                    ))}
                  </span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="wire-title"
                  >
                    {item.title}
                    <ExternalLink size={11} aria-hidden />
                  </a>
                  <span className="wire-publisher">{item.publisher}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {source === "trending" && data?.trending.length ? (
        <p className="term-source">
          Trending on Yahoo Finance: {data.trending.join(", ")}
        </p>
      ) : null}
      <p className="term-source">
        Headlines from Yahoo Finance search, merged across symbols and
        de-duplicated by story.
      </p>
    </div>
  );
}
