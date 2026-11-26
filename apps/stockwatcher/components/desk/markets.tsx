"use client";

import dynamic from "next/dynamic";
import useSWR from "swr";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, Change, Failure, Tick } from "@/components/shared";
import { useQuotes } from "@/components/market-widgets";
import type { Instrument, MarketSeries, Quote } from "@/lib/models";
import {
  benchmarks,
  universes,
  type Range,
  type Universe,
} from "@/lib/universes";
import { compact, percent } from "@/lib/utils";
import { firstWatchlist } from "./data";
import { decodeOverlay } from "@/lib/overlay";
import { Freshness, ListFreshness } from "@/components/freshness";
import {
  DeskEmpty,
  SkeletonRows,
  SymbolButton,
  WidgetFrame,
  latestTime,
  type WidgetProps,
} from "./frame";

const PriceChart = dynamic(() => import("@/components/price-chart"), {
  ssr: false,
  loading: () => <div className="desk-chart-placeholder skeleton" />,
});
const ComparePanel = dynamic(() => import("@/components/comparison"), {
  ssr: false,
  loading: () => <SkeletonRows rows={6} label="Loading comparison" />,
});

const benchmarkLabels: Record<string, string> = benchmarks;

export function WatchlistWidget({ widget, ctx }: WidgetProps<"watchlist">) {
  const { workspace, refresh, onOpenSymbol, onOpenView } = ctx;
  const list = firstWatchlist(workspace, widget.watchlistId);
  const symbols = list?.symbols ?? [];
  const { data, error, mutate, isLoading } = useQuotes(symbols, refresh);
  const bySymbol = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  const limit = widget.span === 2 ? 16 : 10;
  const asOf = latestTime(data?.quotes.map((quote) => quote.time) ?? []);
  return (
    <WidgetFrame
      label="Watchlist"
      className="desk-watchlist"
      subtitle={list ? `${list.name} · ${symbols.length} symbols` : undefined}
      ask={
        list
          ? `Scan my "${list.name}" watchlist (${symbols.slice(0, 20).join(", ")}) for notable moves and news today. What stands out?`
          : undefined
      }
      actions={
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onOpenView({ view: "watchlists" })}
        >
          Manage
        </Button>
      }
      foot={
        <>
          <span>
            {data?.source ?? "Market data"}
            {data?.missing.length
              ? ` · ${data.missing.length} unavailable`
              : ""}
          </span>
          <ListFreshness symbols={refresh ? symbols : []} ms={asOf} />
        </>
      }
    >
      <Failure error={error} retry={mutate} />
      {isLoading ? (
        <SkeletonRows rows={Math.min(limit, Math.max(symbols.length, 4))} />
      ) : symbols.length === 0 ? (
        <DeskEmpty
          title={list ? `${list.name} is empty` : "No watchlist yet"}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenView({ view: "watchlists" })}
            >
              Add symbols
            </Button>
          }
        >
          Follow tickers here with live quotes.
        </DeskEmpty>
      ) : (
        <>
          <div className="desk-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th className="num">Last</th>
                  <th className="num">Chg</th>
                  {widget.span === 2 ? <th className="num">Volume</th> : null}
                </tr>
              </thead>
              <tbody>
                {symbols.slice(0, limit).map((symbol) => {
                  const quote = bySymbol.get(symbol);
                  return (
                    <tr key={symbol}>
                      <td>
                        <SymbolButton symbol={symbol} onOpen={onOpenSymbol} />
                      </td>
                      <td className="desk-name">
                        {quote?.name ?? (
                          <span className="muted">Unavailable</span>
                        )}
                      </td>
                      <td className="num">
                        <Tick value={quote?.price} />{" "}
                        <span className="desk-ccy">{quote?.currency}</span>
                      </td>
                      <td className="num">
                        <Change value={quote?.percent} />
                      </td>
                      {widget.span === 2 ? (
                        <td className="num muted">{compact(quote?.volume)}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {symbols.length > limit ? (
            <button
              type="button"
              className="desk-more"
              onClick={() => onOpenView({ view: "watchlists" })}
            >
              {symbols.length - limit} more in {list?.name}
            </button>
          ) : null}
        </>
      )}
    </WidgetFrame>
  );
}

const chartRanges: Range[] = ["1D", "5D", "1M", "6M", "1Y"];
const isUniverse = (value: string): value is Universe =>
  Object.hasOwn(universes, value);

export function ChartWidget({ widget, ctx }: WidgetProps<"chart">) {
  const { refresh, onOpenSymbol, onOpenView, update, workspace } = ctx;
  const preferences = workspace.settings.chart;
  const range = widget.range ?? "1M";
  const { data, error, mutate, isLoading } = useSWR<MarketSeries>(
    `/api/market?${new URLSearchParams({ symbol: widget.symbol, range, warmup: "1" })}`,
    api,
    { refreshInterval: refresh ? 75_000 : 0, errorRetryCount: 1 },
  );
  const quote = data?.quote;
  const first = data?.points[data.lead ?? 0]?.close;
  const last = data?.points.at(-1)?.close;
  const periodChange = first && last ? (last / first - 1) * 100 : null;
  const unit = widget.symbol.startsWith("^") ? "pts" : quote?.currency;
  const title = benchmarkLabels[widget.symbol] ?? quote?.name;
  return (
    <WidgetFrame
      label="Chart"
      className="desk-chart"
      subtitle={
        <>
          <SymbolButton symbol={widget.symbol} onOpen={onOpenSymbol} />
          {title ? ` · ${title}` : ""}
        </>
      }
      ask={`Analyse ${widget.symbol} price action over ${range}: trend, key levels, and what is driving it.`}
      actions={
        <div className="desk-ranges" role="group" aria-label="Chart period">
          {chartRanges.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={option === range}
              onClick={() => void update({ ...widget, range: option })}
            >
              {option}
            </button>
          ))}
        </div>
      }
      foot={
        <>
          <span>
            {data?.source ?? "Market data"}
            {periodChange != null ? (
              <>
                {" "}
                · {range} <Change value={periodChange} />
              </>
            ) : null}
          </span>
          {quote ? (
            <Freshness
              symbol={refresh ? widget.symbol : undefined}
              quoteMs={quote.time * 1000}
            />
          ) : null}
        </>
      }
    >
      <div className="desk-chart-quote">
        <strong>
          <Tick value={quote?.price} />
        </strong>
        <span className="desk-ccy">{unit}</span>
        <Change value={quote?.percent} arrows />
        <button
          type="button"
          className="desk-link"
          onClick={() =>
            onOpenView({
              view: "research",
              ticker: widget.symbol,
              researchTab: "company",
            })
          }
        >
          Research
        </button>
      </div>
      <Failure error={error} retry={mutate} />
      {isLoading ? (
        <div className="desk-chart-placeholder skeleton" role="status">
          <span className="sr-only">Loading price history</span>
        </div>
      ) : data?.points.length ? (
        <div className="desk-chart-frame">
          <PriceChart
            points={data.points}
            lead={data.lead}
            range={range}
            style={preferences.style}
            studies={preferences.studies}
            log={preferences.log}
            previousClose={quote?.previous}
            currency={unit}
            compact
          />
        </div>
      ) : !error ? (
        <DeskEmpty title="No price history for this period">
          Pick a longer period above.
        </DeskEmpty>
      ) : null}
    </WidgetFrame>
  );
}

export function CompareWidget({ widget, ctx }: WidgetProps<"compare">) {
  return (
    <WidgetFrame
      label="Compare"
      className="desk-compare desk-embed"
      subtitle={`${widget.symbols.join(" · ")}${widget.since ? ` · since ${widget.since}` : ""}`}
      ask={`Compare ${widget.symbols.join(", ")}${widget.since ? ` since ${widget.since}` : ""}: relative performance and what explains the gap.`}
    >
      <ComparePanel
        symbols={widget.symbols}
        since={widget.since}
        apply={(symbols) => void ctx.update({ ...widget, symbols })}
      />
    </WidgetFrame>
  );
}

type QuotesData = {
  quotes: Quote[];
  missing: string[];
  members: Instrument[];
  source: string;
};

function heatTone(value?: number | null) {
  if (value == null) return "heat-missing";
  if (value >= 2) return "heat-gain-strong";
  if (value >= 0.5) return "heat-gain";
  if (value > 0.02) return "heat-gain-soft";
  if (value <= -2) return "heat-loss-strong";
  if (value <= -0.5) return "heat-loss";
  if (value < -0.02) return "heat-loss-soft";
  return "heat-flat";
}

export function MarketWidget({ widget, ctx }: WidgetProps<"market">) {
  const { refresh, onOpenSymbol, onOpenView, update } = ctx;
  const { data, error, mutate, isLoading } = useSWR<QuotesData>(
    `/api/market?${new URLSearchParams({ universe: widget.universe })}`,
    api,
    {
      refreshInterval: refresh && widget.universe !== "S&P 500" ? 90_000 : 0,
      errorRetryCount: 1,
    },
  );
  const bySymbol = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  const tiles = (data?.members ?? []).map((member) => ({
    ...member,
    quote: bySymbol.get(member.symbol),
  }));
  const limit = widget.span === 2 ? 60 : 30;
  const shown =
    tiles.length > limit
      ? tiles
          .toSorted(
            (a, b) =>
              Math.abs(b.quote?.percent ?? 0) - Math.abs(a.quote?.percent ?? 0),
          )
          .slice(0, limit)
      : tiles;
  const up = tiles.filter((tile) => (tile.quote?.percent ?? 0) > 0).length;
  const down = tiles.filter((tile) => (tile.quote?.percent ?? 0) < 0).length;
  const asOf = latestTime(data?.quotes.map((quote) => quote.time) ?? []);
  return (
    <WidgetFrame
      label="Market"
      className="desk-market"
      subtitle={
        <>
          {tiles.length > limit
            ? `${limit} largest moves of ${tiles.length}`
            : "Day moves vs prior close"}{" "}
          ·{" "}
          <span className="positive">
            <ArrowUp size={11} aria-label="advancing" /> {up}
          </span>{" "}
          <span className="negative">
            <ArrowDown size={11} aria-label="declining" /> {down}
          </span>
        </>
      }
      ask={`What is driving the ${widget.universe} today? Highlight breadth, sector leadership and outliers.`}
      actions={
        <>
          <Select
            value={widget.universe}
            onValueChange={(value) => {
              if (isUniverse(value))
                void update({ ...widget, universe: value });
            }}
          >
            <SelectTrigger size="sm" aria-label="Market group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(universes).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              onOpenView({ view: "markets", universe: widget.universe })
            }
          >
            Explore
          </Button>
        </>
      }
      foot={
        <>
          <span>
            {data?.source ?? "Market data"} · {data?.quotes.length ?? "—"}{" "}
            quotes
            {data?.missing.length
              ? ` · ${data.missing.length} unavailable`
              : ""}
          </span>
          <ListFreshness
            symbols={refresh ? tiles.map((tile) => tile.symbol).slice(0, 120) : []}
            ms={asOf}
          />
        </>
      }
    >
      <Failure error={error} retry={mutate} />
      {isLoading ? (
        <div className="desk-tiles-placeholder skeleton" role="status">
          <span className="sr-only">Loading market group</span>
        </div>
      ) : shown.length ? (
        <div className="heat-tiles desk-tiles">
          {shown.map((tile) => (
            <button
              type="button"
              key={tile.symbol}
              className={`heat-tile ${heatTone(tile.quote?.percent)}`}
              title={`${tile.quote?.name ?? tile.name} · ${percent(tile.quote?.percent)}`}
              onClick={() => onOpenSymbol(tile.symbol)}
            >
              <strong>{tile.symbol}</strong>
              <span>{percent(tile.quote?.percent)}</span>
            </button>
          ))}
        </div>
      ) : !error ? (
        <DeskEmpty title="No quotes for this group">
          Pick another market group above.
        </DeskEmpty>
      ) : null}
    </WidgetFrame>
  );
}

const OverlayChart = dynamic(
  () =>
    import("@/components/overlay/overlay-chart").then(
      (module) => module.OverlayChart,
    ),
  { ssr: false, loading: () => <div className="desk-chart-placeholder skeleton" /> },
);

export function OverlayWidget({ widget, ctx }: WidgetProps<"overlay">) {
  const series = decodeOverlay(widget.spec);
  return (
    <WidgetFrame
      label="Overlay"
      className="desk-overlay"
      subtitle={`${widget.title} · ${widget.range}`}
      ask={`Interpret this overlay (${series.map((item) => item.expr).join(", ")}, ${widget.range}): how are these moving together and what does the relationship suggest?`}
      actions={
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            ctx.onOpenView({
              view: "overlay",
              spec: widget.spec,
              period: widget.range,
            })
          }
        >
          Open
        </Button>
      }
    >
      <OverlayChart series={series} range={widget.range} compact />
    </WidgetFrame>
  );
}
