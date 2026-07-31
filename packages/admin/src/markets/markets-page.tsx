"use client";

import { bollinger, ema, rsi, sma } from "@repo/markets/core";
import type {
  CandleSeries,
  DerivedRatios,
  Filing,
  FundamentalPeriod,
  ProviderBudget,
  Quote,
  Resolution,
  SymbolSearchResult,
  Watchlist,
} from "@repo/markets/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Plus, RefreshCw, Search, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { CandleChart, type ChartKind, type Overlay } from "./candle-chart";
import { useQuotes } from "./use-quotes";

const RANGES: { label: string; resolution: Resolution; days: number }[] = [
  { label: "1D", resolution: "5min", days: 1 },
  { label: "5D", resolution: "30min", days: 5 },
  { label: "1M", resolution: "1day", days: 31 },
  { label: "6M", resolution: "1day", days: 183 },
  { label: "1Y", resolution: "1day", days: 365 },
  { label: "5Y", resolution: "1day", days: 1826 },
  { label: "MAX", resolution: "1day", days: 0 },
];

const INDICATORS = [
  { key: "sma20", label: "SMA 20", color: "#f59e0b" },
  { key: "sma50", label: "SMA 50", color: "#8b5cf6" },
  { key: "ema200", label: "EMA 200", color: "#06b6d4" },
  { key: "bb", label: "Bollinger", color: "#64748b" },
] as const;

type IndicatorKey = (typeof INDICATORS)[number]["key"];

export interface MarketsPageProps {
  /** Passed as a prop, not read from a route param: desktop is a static export. */
  ticker?: string;
  onSelectTicker?: (ticker: string) => void;
}

export function MarketsPage({ ticker, onSelectTicker }: MarketsPageProps) {
  const { client } = useAdmin();
  const [selected, setSelected] = useState(ticker ?? "AAPL");
  const [range, setRange] = useState(RANGES[4] as (typeof RANGES)[number]);
  const [kind, setKind] = useState<ChartKind>("candles");
  const [active, setActive] = useState<Set<IndicatorKey>>(new Set(["sma50"]));

  const [series, setSeries] = useState<CandleSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [budget, setBudget] = useState<ProviderBudget | null>(null);
  const [universe, setUniverse] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (ticker) setSelected(ticker.toUpperCase());
  }, [ticker]);

  const choose = useCallback(
    (next: string) => {
      setSelected(next.toUpperCase());
      onSelectTicker?.(next.toUpperCase());
    },
    [onSelectTicker],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const from =
      range.days === 0
        ? undefined
        : new Date(Date.now() - range.days * 86_400_000)
            .toISOString()
            .slice(0, 10);

    const query = new URLSearchParams({
      resolution: range.resolution,
      adjusted: "true",
    });
    if (from) query.set("from", from);

    client
      .get<CandleSeries>(
        `/markets/symbols/${encodeURIComponent(selected)}/candles?${query}`,
      )
      .then((data) => {
        if (cancelled) return;
        setSeries(data);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSeries(null);
        setError(cause instanceof Error ? cause.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, selected, range]);

  const watched = useMemo(() => {
    const tickers = new Set<string>([selected]);
    for (const list of watchlists) {
      for (const item of list.tickers) tickers.add(item);
    }
    return [...tickers];
  }, [watchlists, selected]);

  const loadWatchlists = useCallback(
    () =>
      client
        .get<{ watchlists: Watchlist[] }>("/markets/watchlists")
        .then((data) => setWatchlists(data.watchlists))
        .catch(() => setWatchlists([])),
    [client],
  );

  useEffect(() => {
    void loadWatchlists();
  }, [loadWatchlists]);

  // Relay socket when it is up, batched polling when it is not. Tiingo bills
  // per request rather than per ticker, so the poll covers every visible
  // symbol in one call.
  const { quotes, transport, upstream } = useQuotes(watched);

  useEffect(() => {
    const load = () =>
      client
        .get<{ tiingo: ProviderBudget; symbols: number }>("/markets/budget")
        .then((data) => {
          setBudget(data.tiingo);
          setUniverse(data.symbols);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [client]);

  const seed = useCallback(async () => {
    setSeeding(true);
    try {
      const { symbols } = await client.post<{ symbols: number }>(
        "/markets/symbols/refresh",
      );
      setUniverse(symbols);
    } catch {
      setUniverse(0);
    } finally {
      setSeeding(false);
    }
  }, [client]);

  /** Watchlist membership is edited by rewriting the list's ticker array. */
  const toggleWatch = useCallback(
    async (ticker: string) => {
      const upper = ticker.toUpperCase();
      const target =
        watchlists.find((list) => list.tickers.includes(upper)) ??
        watchlists[0];

      if (!target) {
        const { watchlist } = await client.post<{ watchlist: Watchlist }>(
          "/markets/watchlists",
          { name: "Watchlist", tickers: [upper] },
        );
        setWatchlists([watchlist]);
        return;
      }

      const tickers = target.tickers.includes(upper)
        ? target.tickers.filter((item) => item !== upper)
        : [...target.tickers, upper];

      setWatchlists((current) =>
        current.map((list) =>
          list.id === target.id ? { ...list, tickers } : list,
        ),
      );
      await client
        .patch(`/markets/watchlists/${target.id}`, { tickers })
        .catch(() => void loadWatchlists());
    },
    [client, watchlists, loadWatchlists],
  );

  const bars = series?.bars ?? [];
  const overlays = useMemo<Overlay[]>(() => {
    if (bars.length === 0) return [];
    const closes = bars.map((bar) => bar.close);
    const result: Overlay[] = [];
    if (active.has("sma20")) {
      result.push({ key: "sma20", color: "#f59e0b", values: sma(closes, 20) });
    }
    if (active.has("sma50")) {
      result.push({ key: "sma50", color: "#8b5cf6", values: sma(closes, 50) });
    }
    if (active.has("ema200")) {
      result.push({
        key: "ema200",
        color: "#06b6d4",
        values: ema(closes, 200),
      });
    }
    if (active.has("bb")) {
      const bands = bollinger(closes, 20, 2);
      result.push(
        { key: "bbUpper", color: "#64748b", values: bands.upper },
        { key: "bbLower", color: "#64748b", values: bands.lower },
      );
    }
    return result;
  }, [bars, active]);

  const strength = useMemo(() => {
    if (bars.length < 15) return null;
    return (
      rsi(
        bars.map((bar) => bar.close),
        14,
      ).at(-1) ?? null
    );
  }, [bars]);

  const watching = watchlists.some((list) => list.tickers.includes(selected));
  const quote = quotes.get(selected);
  const last = quote?.last ?? bars.at(-1)?.close ?? null;
  const previous = quote?.prevClose ?? bars.at(-2)?.close ?? null;
  const change = last !== null && previous !== null ? last - previous : null;
  const changePercent =
    change !== null && previous ? (change / previous) * 100 : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <SymbolSearch onSelect={choose} />
        {universe === 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={seeding}
            onClick={() => void seed()}
          >
            <RefreshCw className={`size-3 ${seeding ? "animate-spin" : ""}`} />
            Seed universe
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <TransportDot transport={transport} upstream={upstream} />
          {series?.freshness.stale ? (
            <Badge variant="outline" className="text-amber-600">
              stale
            </Badge>
          ) : null}
          {budget ? <BudgetMeter budget={budget} /> : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r">
          <ScrollArea className="h-full">
            {watchlists.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground text-xs">—</div>
            ) : (
              watchlists.map((list) => (
                <div key={list.id} className="py-1">
                  <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                    {list.name}
                  </div>
                  {list.tickers.map((item) => (
                    <WatchRow
                      key={item}
                      ticker={item}
                      quote={quotes.get(item)}
                      active={item === selected}
                      onSelect={choose}
                      onRemove={() => void toggleWatch(item)}
                    />
                  ))}
                </div>
              ))
            )}
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-2">
            <span className="font-semibold text-lg tabular-nums">
              {selected}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-6"
              aria-label={watching ? "Unwatch" : "Watch"}
              onClick={() => void toggleWatch(selected)}
            >
              {watching ? (
                <Star className="size-3.5 fill-amber-500 text-amber-500" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
            <span className="text-2xl tabular-nums">
              {last === null ? "—" : last.toFixed(2)}
            </span>
            {change !== null && changePercent !== null ? (
              <span
                className={`text-sm tabular-nums ${
                  change >= 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)} ({changePercent.toFixed(2)}%)
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-3 text-muted-foreground text-xs tabular-nums">
              <Stat label="O" value={bars.at(-1)?.open} />
              <Stat label="H" value={bars.at(-1)?.high} />
              <Stat label="L" value={bars.at(-1)?.low} />
              <Stat label="RSI" value={strength ?? undefined} digits={1} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5">
            <Tabs
              value={range.label}
              onValueChange={(value) => {
                const next = RANGES.find((item) => item.label === value);
                if (next) setRange(next);
              }}
            >
              <TabsList variant="line" className="h-7">
                {RANGES.map((item) => (
                  <TabsTrigger
                    key={item.label}
                    value={item.label}
                    className="px-2 text-xs"
                  >
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Tabs
              value={kind}
              onValueChange={(value) => setKind(value as ChartKind)}
            >
              <TabsList variant="line" className="h-7">
                <TabsTrigger value="candles" className="px-2 text-xs">
                  Candles
                </TabsTrigger>
                <TabsTrigger value="area" className="px-2 text-xs">
                  Line
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="ml-auto flex gap-1">
              {INDICATORS.map((indicator) => (
                <Button
                  key={indicator.key}
                  size="sm"
                  variant={active.has(indicator.key) ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    setActive((current) => {
                      const next = new Set(current);
                      if (next.has(indicator.key)) next.delete(indicator.key);
                      else next.add(indicator.key);
                      return next;
                    })
                  }
                >
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ background: indicator.color }}
                  />
                  {indicator.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 px-2 py-2">
            {loading ? (
              <Skeleton className="h-[420px] w-full" />
            ) : error ? (
              <div className="px-2 py-4 text-red-600 text-xs">{error}</div>
            ) : bars.length === 0 ? (
              <div className="px-2 py-4 text-muted-foreground text-xs">—</div>
            ) : (
              <CandleChart
                bars={bars}
                kind={kind}
                overlays={overlays}
                fitKey={`${selected}:${range.label}:${kind}`}
              />
            )}
          </div>

          <Fundamentals ticker={selected} />
        </main>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  digits = 2,
}: {
  label: string;
  value?: number;
  digits?: number;
}) {
  return (
    <span>
      {label} {value === undefined ? "—" : value.toFixed(digits)}
    </span>
  );
}

function WatchRow({
  ticker,
  quote,
  active,
  onSelect,
  onRemove,
}: {
  ticker: string;
  quote?: Quote;
  active: boolean;
  onSelect: (ticker: string) => void;
  onRemove: () => void;
}) {
  const change =
    quote?.last != null && quote.prevClose
      ? ((quote.last - quote.prevClose) / quote.prevClose) * 100
      : null;

  return (
    <div
      className={`group flex items-center gap-1 pr-1 hover:bg-muted/60 ${
        active ? "bg-muted" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(ticker)}
        className="flex min-w-0 flex-1 items-baseline justify-between px-3 py-1 text-left text-xs"
      >
        <span className="font-medium">{ticker}</span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <span>{quote?.last?.toFixed(2) ?? "—"}</span>
          <span
            className={
              change === null
                ? "text-muted-foreground"
                : change >= 0
                  ? "text-emerald-600"
                  : "text-red-600"
            }
          >
            {change === null
              ? "—"
              : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${ticker}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function TransportDot({
  transport,
  upstream,
}: {
  transport: "ws" | "poll";
  upstream: "connected" | "connecting" | "disconnected" | null;
}) {
  const live = transport === "ws" && upstream === "connected";
  const colour = live
    ? "bg-emerald-500"
    : transport === "ws"
      ? "bg-amber-500"
      : "bg-muted-foreground";

  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <span className={`inline-block size-1.5 rounded-full ${colour}`} />
      {live ? "live" : transport === "ws" ? (upstream ?? "…") : "poll"}
    </span>
  );
}

function BudgetMeter({ budget }: { budget: ProviderBudget }) {
  const hour = (budget.hourUsed / budget.hourLimit) * 100;
  const day = (budget.dayUsed / budget.dayLimit) * 100;
  const critical = hour > 80 || day > 80;

  return (
    <span
      className={`text-xs tabular-nums ${
        critical ? "text-amber-600" : "text-muted-foreground"
      }`}
    >
      {budget.hourUsed}/{budget.hourLimit}h · {budget.dayUsed}/{budget.dayLimit}
      d
    </span>
  );
}

function SymbolSearch({ onSelect }: { onSelect: (ticker: string) => void }) {
  const { client } = useAdmin();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    // Debounced: search hits Mongo, not a provider, but a keystroke-per-query
    // still floods the route on a fast typist.
    timer.current = setTimeout(() => {
      client
        .get<{ results: SymbolSearchResult[] }>(
          `/markets/symbols/search?q=${encodeURIComponent(query.trim())}`,
        )
        .then((data) => setResults(data.results))
        .catch(() => setResults([]));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [client, query]);

  return (
    <div className="relative w-72">
      <Search className="-translate-y-1/2 absolute top-1/2 left-2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Ticker"
        className="h-8 pl-7 text-xs"
      />
      {open && results.length > 0 ? (
        <div className="absolute top-9 left-0 z-50 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.slice(0, 12).map((result) => (
            <button
              key={result.ticker}
              type="button"
              onMouseDown={() => {
                onSelect(result.ticker);
                setQuery("");
              }}
              className="flex w-full items-baseline justify-between px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span className="font-medium">{result.ticker}</span>
              <span className="ml-2 truncate text-muted-foreground">
                {result.name}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Fundamentals({ ticker }: { ticker: string }) {
  const { client } = useAdmin();
  const [ratios, setRatios] = useState<DerivedRatios | null>(null);
  const [periods, setPeriods] = useState<FundamentalPeriod[]>([]);
  const [filings, setFilings] = useState<Filing[]>([]);

  useEffect(() => {
    setRatios(null);
    setPeriods([]);
    client
      .get<{ ratios: DerivedRatios; periods: FundamentalPeriod[] }>(
        `/markets/symbols/${encodeURIComponent(ticker)}/fundamentals`,
      )
      .then((data) => {
        setRatios(data.ratios);
        setPeriods(data.periods);
      })
      .catch(() => undefined);
    client
      .get<{ filings: Filing[] }>(
        `/markets/symbols/${encodeURIComponent(ticker)}/filings?limit=8`,
      )
      .then((data) => setFilings(data.filings))
      .catch(() => setFilings([]));
  }, [client, ticker]);

  const latest = periods[0];

  return (
    <div className="grid shrink-0 grid-cols-1 gap-4 border-t px-4 py-3 text-xs md:grid-cols-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Ratio label="P/E" value={ratios?.peRatio} />
        <Ratio label="P/B" value={ratios?.priceToBook} />
        <Ratio label="P/S" value={ratios?.priceToSales} />
        <Ratio label="EPS" value={ratios?.eps} />
        <Ratio label="Gross margin" value={ratios?.grossMargin} percent />
        <Ratio label="Net margin" value={ratios?.netMargin} percent />
        <Ratio label="ROE" value={ratios?.returnOnEquity} percent />
        <Ratio label="D/E" value={ratios?.debtToEquity} />
      </div>

      <div className="space-y-1">
        {latest ? (
          <>
            <div className="text-muted-foreground">
              {latest.form} · {latest.fiscalPeriod} {latest.fiscalYear} ·{" "}
              {latest.periodEnd}
            </div>
            {latest.facts
              .filter((fact) => fact.statement === "income")
              .slice(0, 6)
              .map((fact) => (
                <div key={fact.key} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{fact.label}</span>
                  <span className="tabular-nums">{compact(fact.value)}</span>
                </div>
              ))}
          </>
        ) : (
          <div className="text-muted-foreground">—</div>
        )}
      </div>

      <div className="space-y-1">
        {filings.length === 0 ? (
          <div className="text-muted-foreground">—</div>
        ) : (
          filings.map((filing) => (
            <a
              key={filing.accession}
              href={filing.url}
              target="_blank"
              rel="noreferrer"
              className="flex justify-between gap-2 hover:underline"
            >
              <span>{filing.form}</span>
              <span className="text-muted-foreground tabular-nums">
                {filing.filed}
              </span>
            </a>
          ))
        )}
      </div>
    </div>
  );
}

function Ratio({
  label,
  value,
  percent = false,
}: {
  label: string;
  value?: number | null;
  percent?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        {value === null || value === undefined
          ? "—"
          : percent
            ? `${(value * 100).toFixed(1)}%`
            : value.toFixed(2)}
      </span>
    </div>
  );
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}

export function MarketsSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b px-4">
        <Skeleton className="h-8 w-72" />
      </div>
      <div className="flex flex-1">
        <div className="w-56 space-y-2 border-r p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={`row-${i}`} className="h-4 w-full" />
          ))}
        </div>
        <div className="flex-1 space-y-3 p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[420px] w-full" />
        </div>
      </div>
    </div>
  );
}
