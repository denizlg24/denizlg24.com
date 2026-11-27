"use client";

import { Plus, SlidersHorizontal } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useLiveStatus } from "@/components/live-quotes";
import { useQuotes } from "@/components/market-widgets";
import type { Quote } from "@/lib/models";
import { tickerLabel } from "@/lib/ticker";
import { tone } from "@/lib/utils";

declare module "react" {
  interface CSSProperties {
    "--ticker-duration"?: string;
  }
}

const liveLabels = {
  live: ["Live", "Streaming quotes from the markets relay"],
  idle: ["Live", "Connected; the upstream feed is quiet or reconnecting"],
  connecting: ["Conn", "Connecting to live quotes"],
} as const;

function LiveBadge() {
  const status = useLiveStatus();
  if (status === "off")
    return (
      <span
        className="live-badge"
        data-status="off"
        title="Exchange-delayed quotes"
      >
        <i aria-hidden />
        Delayed
      </span>
    );
  const [label, title] = liveLabels[status];
  return (
    <span className="live-badge" data-status={status} title={title}>
      <i aria-hidden />
      {label}
    </span>
  );
}

const priceFormat = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(value) < 20 ? 4 : 2,
  });

function changeText(value: number | null | undefined) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function Items({
  symbols,
  quotes,
  loading,
  selected,
  onSymbol,
  copy = false,
}: {
  symbols: string[];
  quotes: Map<string, Quote>;
  loading: boolean;
  selected: string;
  onSymbol: (symbol: string) => void;
  copy?: boolean;
}) {
  return (
    <ul
      className="ticker-list"
      data-copy={copy || undefined}
      aria-hidden={copy || undefined}
      inert={copy}
    >
      {symbols.map((symbol) => {
        const quote = quotes.get(symbol);
        const change = quote?.percent;
        const direction = tone(change);
        return (
          <li key={symbol}>
            <button
              type="button"
              className="ticker-item"
              aria-pressed={symbol === selected}
              title={quote?.name ?? symbol}
              onClick={() => onSymbol(symbol)}
            >
              <span className="ticker-sym">{tickerLabel(symbol)}</span>
              <span className="ticker-last">
                {quote ? (
                  priceFormat(quote.price)
                ) : loading ? (
                  <i className="number-placeholder" />
                ) : (
                  "—"
                )}
              </span>
              <span className={`ticker-chg ${direction}`}>
                {direction === "positive" ? (
                  <span aria-hidden>▲</span>
                ) : direction === "negative" ? (
                  <span aria-hidden>▼</span>
                ) : null}
                {changeText(change)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TickerStrip({
  symbols,
  selected,
  refresh,
  inert = false,
  onSymbol,
  onEdit,
}: {
  symbols: string[];
  selected: string;
  refresh: boolean;
  inert?: boolean;
  onSymbol: (symbol: string) => void;
  onEdit: () => void;
}) {
  const { data, error, mutate, isLoading } = useQuotes(symbols, refresh);
  const quotes = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<{ list: number; viewport: number }>();

  useEffect(() => {
    const outer = viewport.current;
    const inner = list.current?.querySelector(".ticker-list");
    if (!outer || !(inner instanceof HTMLElement)) return;
    const measure = () =>
      setWidth({ list: inner.scrollWidth, viewport: outer.clientWidth });
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, []);

  const moving = width ? width.list > width.viewport : false;
  const style: CSSProperties | undefined = width
    ? { "--ticker-duration": `${Math.max(20, width.list / 45)}s` }
    : undefined;
  const failed = Boolean(error && !data);

  return (
    <section className="ticker-strip" aria-label="Ticker" inert={inert}>
      <div className="ticker-lead">
        <LiveBadge />
      </div>
      <div
        className="ticker-viewport"
        ref={viewport}
        data-moving={moving || undefined}
      >
        {symbols.length === 0 ? (
          <button type="button" className="ticker-empty" onClick={onEdit}>
            <Plus aria-hidden /> Add symbols to the ticker
          </button>
        ) : failed ? (
          <span className="ticker-error">
            Quotes unavailable ·{" "}
            <button type="button" onClick={() => void mutate()}>
              Retry
            </button>
          </span>
        ) : null}
        <div className="ticker-track" ref={list} style={style} hidden={failed}>
          <Items
            symbols={symbols}
            quotes={quotes}
            loading={isLoading}
            selected={selected}
            onSymbol={onSymbol}
          />
          {moving ? (
            <Items
              symbols={symbols}
              quotes={quotes}
              loading={isLoading}
              selected={selected}
              onSymbol={onSymbol}
              copy
            />
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="ticker-edit"
        aria-label="Edit ticker symbols"
        title="Edit ticker"
        onClick={onEdit}
      >
        <SlidersHorizontal aria-hidden />
      </button>
    </section>
  );
}
