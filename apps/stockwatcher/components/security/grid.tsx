"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import useSWR from "swr";
import { ScalePicker } from "@/components/chart/studio-controls";
import { StylePicker } from "@/components/chart-controls";
import { marketURL, useQuotes } from "@/components/market-widgets";
import { api, Change, Empty, Failure, Loading } from "@/components/shared";
import type { ChartScale, ChartStyle, MarketSeries } from "@/lib/models";
import { type Range, ranges, symbolPattern } from "@/lib/universes";
import { amount } from "@/lib/utils";

const PriceChart = dynamic(() => import("@/components/price-chart"), {
  ssr: false,
  loading: () => <Loading />,
});

const layouts = {
  "2×2": { columns: 2, cells: 4 },
  "3×2": { columns: 3, cells: 6 },
  "3×3": { columns: 3, cells: 9 },
} as const;
type Layout = keyof typeof layouts;
const defaults = [
  "^GSPC",
  "^NDX",
  "^STOXX50E",
  "^N225",
  "GC=F",
  "CL=F",
  "^TNX",
  "EURUSD=X",
  "BTC-USD",
];

function Cell({
  symbol,
  range,
  style,
  scale,
  volume,
  quotePercent,
  quotePrice,
  onChange,
  onOpen,
}: {
  symbol: string;
  range: Range;
  style: ChartStyle;
  scale: ChartScale;
  volume: boolean;
  quotePercent?: number | null;
  quotePrice?: number;
  onChange: (symbol: string) => void;
  onOpen: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR<MarketSeries>(
    marketURL({ symbol, range, warmup: "1" }),
    api,
    { errorRetryCount: 1, revalidateOnFocus: false },
  );
  const lead = data?.lead ?? 0;
  const first = data?.points[lead]?.close;
  const last = data?.points.at(-1)?.close;
  const period = first && last ? (last / first - 1) * 100 : null;
  return (
    <section className="grid-cell" aria-label={`${symbol} chart`}>
      <header>
        {draft != null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = draft.trim().toUpperCase();
              if (symbolPattern.test(next)) onChange(next);
              setDraft(null);
            }}
          >
            <input
              autoFocus
              className="studio-select grid-input"
              value={draft}
              aria-label="Symbol"
              onChange={(event) => setDraft(event.target.value.toUpperCase())}
              onBlur={() => setDraft(null)}
            />
          </form>
        ) : (
          <button
            type="button"
            className="grid-symbol"
            title="Change symbol"
            onClick={() => setDraft(symbol)}
          >
            {symbol}
          </button>
        )}
        <span className="grid-name">{data?.quote?.name ?? ""}</span>
        <b>{amount(quotePrice ?? data?.quote?.price)}</b>
        <Change value={quotePercent ?? data?.quote?.percent} />
        <span className="grid-period" title={`Change over ${range}`}>
          {range} <Change value={period} />
        </span>
        <button type="button" className="chip" onClick={onOpen} title="Open GP">
          GP
        </button>
      </header>
      {error ? (
        <Failure error={error} retry={() => void mutate()} />
      ) : isLoading ? (
        <Loading />
      ) : data?.points.length ? (
        <div className="grid-chart">
          <PriceChart
            points={data.points}
            lead={lead}
            range={range}
            style={style}
            scale={scale}
            studies={volume ? ["volume"] : []}
            previousClose={data.quote?.previous}
            compact
          />
        </div>
      ) : (
        <Empty title="No history" />
      )}
    </section>
  );
}

export function ChartGrid({
  initial,
  select,
}: {
  initial?: string[];
  select: (symbol: string) => void;
}) {
  const [layout, setLayout] = useState<Layout>(
    initial && initial.length > 6
      ? "3×3"
      : initial && initial.length > 4
        ? "3×2"
        : "2×2",
  );
  const [symbols, setSymbols] = useState<string[]>(() => {
    const chosen = initial?.length ? initial : [];
    return [
      ...chosen,
      ...defaults.filter((item) => !chosen.includes(item)),
    ].slice(0, 9);
  });
  const [range, setRange] = useState<Range>("3M");
  const [style, setStyle] = useState<ChartStyle>("line");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [volume, setVolume] = useState(false);
  const { columns, cells } = layouts[layout];
  const shown = symbols.slice(0, cells);
  const { data } = useQuotes(shown, true);
  const quotes = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <div className="seg" role="group" aria-label="Layout">
            {(Object.keys(layouts) as Layout[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={layout === key}
                onClick={() => setLayout(key)}
              >
                {key}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Period for every chart">
            {(Object.keys(ranges) as Range[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={range === key}
                onClick={() => setRange(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
        <div className="row-actions">
          <StylePicker value={style} onChange={setStyle} />
          <ScalePicker value={scale} onChange={setScale} />
          <button
            type="button"
            className="chip"
            aria-pressed={volume}
            onClick={() => setVolume(!volume)}
          >
            Volume
          </button>
        </div>
      </div>
      <div
        className="chart-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {shown.map((symbol, index) => (
          <Cell
            key={`${index}-${symbol}`}
            symbol={symbol}
            range={range}
            style={style}
            scale={scale}
            volume={volume}
            quotePrice={quotes.get(symbol)?.price}
            quotePercent={quotes.get(symbol)?.percent}
            onChange={(next) =>
              setSymbols(symbols.map((item, i) => (i === index ? next : item)))
            }
            onOpen={() => select(symbol)}
          />
        ))}
      </div>
      <p className="term-source">
        Click a symbol to replace it. Period, style and scale apply to every
        panel.
      </p>
    </div>
  );
}
