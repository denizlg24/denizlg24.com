"use client";

import {
  bollinger,
  ema,
  type MarketSession,
  marketSession,
  rsi,
  sma,
} from "@repo/markets/core";
import type {
  CandleSeries,
  CompanyNewsItem,
  CompanyProfile,
  CorporateAction,
  DerivedRatios,
  Filing,
  FundamentalPeriod,
  MarketSymbol,
  ProviderBudget,
  Quote,
  Resolution,
  Watchlist,
} from "@repo/markets/schemas";
import { isIntraday } from "@repo/markets/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ScrollArea } from "@repo/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { ListTree, Plus, RefreshCw, Star, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { CandleChart, type ChartKind, type Overlay } from "./candle-chart";
import { QuickTrade } from "./quick-trade";
import { SymbolSearch } from "./symbol-search";
import { useLiveRefresh } from "./use-live-refresh";
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

/**
 * Refresh cadences. None of these decide what a provider request costs — the
 * routes ration that behind their own TTLs — so they are set by how fast the
 * data can change, not by how much it is worth.
 */
const INTRADAY_CHART_MS = 60_000;
/** A daily bar only settles once, but a returning tab must not show yesterday. */
const DAILY_CHART_MS = 300_000;
/** Multiples move with the price, so they go stale as fast as the quote does. */
const RATIOS_MS = 60_000;
/** Filings, profile and the ticker universe move on a scale of days. */
const REFERENCE_MS = 600_000;
const BUDGET_MS = 60_000;

interface SymbolDetailResponse {
  symbol: MarketSymbol | null;
  profile: CompanyProfile | null;
  stale: boolean;
}

export interface MarketsPageProps {
  /** Passed as a prop, not read from a route param: desktop is a static export. */
  ticker?: string;
  onSelectTicker?: (ticker: string) => void;
}

export function MarketsPage({ ticker, onSelectTicker }: MarketsPageProps) {
  const { client, routes } = useAdmin();
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
  const [detail, setDetail] = useState<SymbolDetailResponse | null>(null);

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

  const requestedSeries = useRef("");
  const loadSeries = useCallback(
    (quiet: boolean) => {
      const key = `${selected}:${range.label}`;
      requestedSeries.current = key;
      if (!quiet) {
        setLoading(true);
        setError(null);
      }

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
          if (requestedSeries.current !== key) return;
          setSeries(data);
        })
        .catch((cause: unknown) => {
          // A failed quiet refresh keeps the chart that is already drawn; only
          // the load the user asked for is allowed to replace it with an error.
          if (requestedSeries.current !== key || quiet) return;
          setSeries(null);
          setError(cause instanceof Error ? cause.message : "Failed to load");
        })
        .finally(() => {
          if (requestedSeries.current === key && !quiet) setLoading(false);
        });
    },
    [client, selected, range],
  );

  useEffect(() => {
    loadSeries(false);
  }, [loadSeries]);

  // An intraday bar is still forming, so it is worth re-asking for often; a
  // daily one settles once, but a tab left open overnight must still catch up.
  // The route decides what either costs — it reaches a provider at most once per
  // bar interval, and not at all once the session is over.
  useLiveRefresh(() => loadSeries(true), {
    intervalMs: isIntraday(range.resolution)
      ? INTRADAY_CHART_MS
      : DAILY_CHART_MS,
  });

  const requestedDetail = useRef("");
  const loadDetail = useCallback(
    (quiet: boolean) => {
      // Without the guard a slow response for the previous ticker can resolve
      // last and put another company's name, logo and market cap in the header.
      requestedDetail.current = selected;
      if (!quiet) setDetail(null);
      client
        .get<SymbolDetailResponse>(
          `/markets/symbols/${encodeURIComponent(selected)}`,
        )
        .then((data) => {
          if (requestedDetail.current === selected) setDetail(data);
        })
        .catch(() => {
          if (requestedDetail.current === selected && !quiet) setDetail(null);
        });
    },
    [client, selected],
  );

  useEffect(() => {
    loadDetail(false);
  }, [loadDetail]);

  useLiveRefresh(() => loadDetail(true), { intervalMs: REFERENCE_MS });

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

  // The desktop app edits the same lists, so this surface is not the only
  // writer and cannot assume its own copy is current.
  useLiveRefresh(() => void loadWatchlists(), { intervalMs: REFERENCE_MS });

  // Relay socket when it is up, batched polling when it is not. Tiingo bills
  // per request rather than per ticker, so the poll covers every visible
  // symbol in one call.
  const { quotes, transport, upstream } = useQuotes(watched);

  const loadBudget = useCallback(
    () =>
      client
        .get<{ tiingo: ProviderBudget; symbols: number }>("/markets/budget")
        .then((data) => {
          setBudget(data.tiingo);
          setUniverse(data.symbols);
        })
        .catch(() => undefined),
    [client],
  );

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  useLiveRefresh(() => void loadBudget(), { intervalMs: BUDGET_MS });

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
  const session = useMarketSession();

  // The session's own figures, not the last bar on the chart: on the intraday
  // ranges that bar is a five-minute candle, so its open and low described the
  // last five minutes rather than the day, and on a cold cache it was absent
  // entirely. `daily` is the fallback for a symbol the quote feed has not
  // reached yet.
  const daily = series?.resolution === "1day" ? bars.at(-1) : undefined;
  const sessionStats = {
    open: quote?.open ?? daily?.open,
    high: quote?.high ?? daily?.high,
    low: quote?.low ?? daily?.low,
    close: previous ?? undefined,
    volume: quote?.volume ?? daily?.volume,
  };

  const watchlistPanel = (
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
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:gap-3 sm:px-4 lg:flex-nowrap lg:py-0">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-8 lg:hidden"
              aria-label="Watchlists"
            >
              <ListTree className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b px-3 py-2">
              <SheetTitle className="text-sm">Watchlists</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              {watchlistPanel}
            </div>
          </SheetContent>
        </Sheet>
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
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <SessionBadge session={session} />
          <a
            href={routes.portfolios}
            className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
          >
            <Wallet className="size-3.5" />
            <span className="hidden sm:inline">Portfolios</span>
          </a>
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
        <aside className="hidden w-56 shrink-0 border-r lg:block">
          {watchlistPanel}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 sm:px-4">
            <CompanyLogo
              url={detail?.profile?.logoUrl}
              name={detail?.profile?.name ?? selected}
              size={22}
            />
            <span className="font-semibold text-lg tabular-nums">
              {selected}
            </span>
            {detail?.symbol ? (
              <span className="hidden max-w-56 truncate text-muted-foreground text-xs sm:inline">
                {detail.symbol.name}
              </span>
            ) : null}
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
            <QuickTrade ticker={selected} lastPrice={last} />
            <div className="flex w-full flex-wrap items-center gap-x-3 text-muted-foreground text-xs tabular-nums sm:ml-auto sm:w-auto sm:justify-end">
              {detail?.profile?.sector ? (
                <span className="hidden max-w-40 truncate xl:inline">
                  {detail.profile.sector}
                </span>
              ) : null}
              {detail?.profile?.marketCap ? (
                <span className="hidden lg:inline">
                  {compact(detail.profile.marketCap)}
                </span>
              ) : null}
              <Stat label="O" value={sessionStats.open} />
              <Stat label="H" value={sessionStats.high} />
              <Stat label="L" value={sessionStats.low} />
              <Stat label="C" value={sessionStats.close} />
              <span className="hidden sm:inline">
                Vol{" "}
                {sessionStats.volume === undefined
                  ? "—"
                  : compact(sessionStats.volume)}
              </span>
              <Stat label="RSI" value={strength ?? undefined} digits={1} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 sm:px-4">
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

            <div className="flex flex-wrap gap-1 sm:ml-auto sm:flex-nowrap">
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

          {/* Below lg the chart takes a definite height and the column scrolls,
              rather than every pane splitting one phone screen between them.
              Definite rather than a minimum: the chart fills its container, and
              a `flex-1` box inside a scrolling column has no height to fill. */}
          <div className="h-72 shrink-0 px-2 py-2 lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
            {loading ? (
              <Skeleton className="h-full w-full" />
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

          <SymbolDetail
            ticker={selected}
            symbol={detail?.symbol ?? null}
            profile={detail?.profile ?? null}
          />
        </main>
      </div>
    </div>
  );
}

/**
 * A plain `<img>`, not `next/image`: logos come from whatever CDN Finnhub
 * points at, and desktop is a static export with no image optimiser to run
 * them through. A broken or missing URL falls back to the ticker's initial
 * rather than leaving a gap where the mark should be.
 */
function CompanyLogo({
  url,
  name,
  size = 22,
}: {
  url?: string;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  // A new symbol gets a fresh attempt; without this one broken logo would
  // suppress every logo after it.
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded bg-muted font-medium text-[10px] text-muted-foreground"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded bg-white object-contain"
      style={{ width: size, height: size }}
    />
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

/**
 * Recomputed on a timer rather than on render, so the badge flips at the bell
 * without the page being touched. A minute is finer than any boundary needs.
 */
function useMarketSession(): MarketSession {
  const [session, setSession] = useState(() => marketSession(new Date()));
  useEffect(() => {
    const tick = () => setSession(marketSession(new Date()));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return session;
}

const SESSION_LABELS: Record<MarketSession["state"], string> = {
  pre: "pre",
  open: "open",
  after: "after",
  closed: "closed",
};

function SessionBadge({ session }: { session: MarketSession }) {
  const colour =
    session.state === "open"
      ? "bg-emerald-500"
      : session.state === "closed"
        ? "bg-muted-foreground"
        : "bg-amber-500";

  const change = session.nextChangeAt ? new Date(session.nextChangeAt) : null;
  const relative = change ? untilLabel(change) : null;

  return (
    <span
      className="flex items-center gap-1.5 text-muted-foreground text-xs tabular-nums"
      title={
        change
          ? `${session.state === "open" ? "Closes" : "Next session"} ${change.toLocaleString()}`
          : undefined
      }
    >
      <span className={`inline-block size-1.5 rounded-full ${colour}`} />
      {SESSION_LABELS[session.state]}
      {relative ? <span className="hidden md:inline">{relative}</span> : null}
      {session.earlyClose ? (
        <span className="hidden text-amber-600 lg:inline">½</span>
      ) : null}
    </span>
  );
}

function untilLabel(target: Date): string {
  const minutes = Math.round((target.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d`;
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

type DetailTab = "company" | "fundamentals" | "filings" | "actions" | "news";

function SymbolDetail({
  ticker,
  symbol,
  profile,
}: {
  ticker: string;
  symbol: MarketSymbol | null;
  profile: CompanyProfile | null;
}) {
  const { client } = useAdmin();
  const [tab, setTab] = useState<DetailTab>("company");
  const [ratios, setRatios] = useState<DerivedRatios | null>(null);
  const [periods, setPeriods] = useState<FundamentalPeriod[]>([]);
  const [filings, setFilings] = useState<Filing[]>([]);
  const [actions, setActions] = useState<CorporateAction[]>([]);
  const [news, setNews] = useState<CompanyNewsItem[]>([]);

  // Every fetch here is guarded on the ticker: the previous symbol's response
  // can otherwise resolve after the new one and leave another company's data on
  // screen. A quiet refresh additionally never clears what is already drawn.
  const requested = useRef("");
  const load = useCallback(
    (quiet: boolean) => {
      requested.current = ticker;
      if (!quiet) {
        setRatios(null);
        setPeriods([]);
        setFilings([]);
      }
      client
        .get<{ ratios: DerivedRatios; periods: FundamentalPeriod[] }>(
          `/markets/symbols/${encodeURIComponent(ticker)}/fundamentals`,
        )
        .then((data) => {
          if (requested.current !== ticker) return;
          setRatios(data.ratios);
          setPeriods(data.periods);
        })
        .catch(() => undefined);
      client
        .get<{ filings: Filing[] }>(
          `/markets/symbols/${encodeURIComponent(ticker)}/filings?limit=20`,
        )
        .then((data) => {
          if (requested.current === ticker) setFilings(data.filings);
        })
        .catch(() => {
          if (requested.current === ticker && !quiet) setFilings([]);
        });
    },
    [client, ticker],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // The ratios are the reason for the cadence: they are price over a reported
  // fundamental, recomputed server-side per request, so they drift with the
  // quote even though the filings behind them have not moved.
  useLiveRefresh(() => load(true), { intervalMs: RATIOS_MS });

  // Actions and news are read on demand: both routes can reach a provider on a
  // miss, so loading them with the page would charge for tabs never opened. For
  // the same reason their refresh is gated on the tab still being the open one.
  const loadActions = useCallback(() => {
    requested.current = ticker;
    client
      .get<{ actions: CorporateAction[] }>(
        `/markets/symbols/${encodeURIComponent(ticker)}/actions`,
      )
      .then((data) => {
        if (requested.current === ticker) setActions(data.actions);
      })
      .catch(() => undefined);
  }, [client, ticker]);

  useEffect(() => {
    if (tab !== "actions") return;
    setActions([]);
    loadActions();
  }, [tab, loadActions]);

  useLiveRefresh(loadActions, {
    intervalMs: REFERENCE_MS,
    enabled: tab === "actions",
  });

  const loadNews = useCallback(() => {
    requested.current = ticker;
    client
      .get<{ news: CompanyNewsItem[] }>(
        `/markets/symbols/${encodeURIComponent(ticker)}/news?limit=30`,
      )
      .then((data) => {
        if (requested.current === ticker) setNews(data.news);
      })
      .catch(() => undefined);
  }, [client, ticker]);

  useEffect(() => {
    if (tab !== "news") return;
    setNews([]);
    loadNews();
  }, [tab, loadNews]);

  useLiveRefresh(loadNews, {
    intervalMs: REFERENCE_MS,
    enabled: tab === "news",
  });

  const latest = periods[0];

  return (
    <div className="flex h-56 shrink-0 flex-col border-t max-lg:h-64">
      {/* `pb-1.5` is not spacing. The line-variant trigger paints its active
          underline at `bottom-[-5px]`, five pixels below the list's own box, and
          `overflow-x-auto` here forces overflow-y to non-visible — so with no
          bottom padding the underline was clipped and the strip grew a scrollbar
          for the couple of pixels it could not contain. */}
      <div className="flex shrink-0 items-center overflow-x-auto px-3 pt-1 pb-1.5 sm:px-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="company" className="px-2 text-xs">
              Company
            </TabsTrigger>
            <TabsTrigger value="fundamentals" className="px-2 text-xs">
              Fundamentals
            </TabsTrigger>
            <TabsTrigger value="filings" className="px-2 text-xs">
              Filings
            </TabsTrigger>
            <TabsTrigger value="actions" className="px-2 text-xs">
              Actions
            </TabsTrigger>
            <TabsTrigger value="news" className="px-2 text-xs">
              News
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {tab === "company" ? (
          <Company ticker={ticker} symbol={symbol} profile={profile} />
        ) : tab === "fundamentals" ? (
          <div className="grid grid-cols-1 gap-4 px-4 py-2 text-xs md:grid-cols-2">
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
                    .slice(0, 8)
                    .map((fact) => (
                      <div
                        key={fact.key}
                        className="flex justify-between gap-2"
                      >
                        <span className="text-muted-foreground">
                          {fact.label}
                        </span>
                        <span className="tabular-nums">
                          {compact(fact.value)}
                        </span>
                      </div>
                    ))}
                </>
              ) : (
                <div className="text-muted-foreground">—</div>
              )}
            </div>
          </div>
        ) : tab === "filings" ? (
          <div className="space-y-1 px-4 py-2 text-xs">
            {filings.length === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              filings.map((filing) => (
                <a
                  key={filing.accession}
                  href={filing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-baseline gap-3 hover:underline"
                >
                  <span className="w-16 shrink-0 font-medium">
                    {filing.form}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {filing.filed}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {filing.accession}
                  </span>
                </a>
              ))
            )}
          </div>
        ) : tab === "actions" ? (
          <div className="space-y-1 px-4 py-2 text-xs">
            {actions.length === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              [...actions]
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((action) => (
                  <div
                    key={`${action.date}:${action.divCash}:${action.splitFactor}`}
                    className="flex items-baseline gap-3"
                  >
                    <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                      {action.date}
                    </span>
                    {action.divCash !== 0 ? (
                      <span className="tabular-nums">
                        div {action.divCash.toFixed(4)}
                      </span>
                    ) : null}
                    {action.splitFactor !== 1 ? (
                      <span className="tabular-nums">
                        split ×{action.splitFactor}
                      </span>
                    ) : null}
                  </div>
                ))
            )}
          </div>
        ) : (
          <div className="space-y-1.5 px-4 py-2 text-xs">
            {news.length === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              news.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-baseline gap-3 hover:underline"
                >
                  <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                    {item.publishedAt.slice(5, 16).replace("T", " ")}
                  </span>
                  <span className="min-w-0 truncate">{item.headline}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {item.source}
                  </span>
                </a>
              ))
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function Company({
  ticker,
  symbol,
  profile,
}: {
  ticker: string;
  symbol: MarketSymbol | null;
  profile: CompanyProfile | null;
}) {
  if (!symbol && !profile) {
    return <div className="px-4 py-2 text-muted-foreground text-xs">—</div>;
  }

  return (
    <div className="flex gap-4 px-4 py-3 text-xs">
      <CompanyLogo
        url={profile?.logoUrl}
        name={profile?.name ?? symbol?.name ?? ticker}
        size={48}
      />
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
        <Field label="Name" value={profile?.name ?? symbol?.name} />
        <Field label="Exchange" value={symbol?.exchange} />
        <Field label="Type" value={symbol?.assetType} />
        <Field label="Sector" value={profile?.sector} />
        <Field label="Country" value={profile?.country} />
        <Field label="Currency" value={symbol?.currency} />
        <Field
          label="Market cap"
          value={profile?.marketCap ? compact(profile.marketCap) : undefined}
        />
        <Field
          label="Shares"
          value={
            profile?.sharesOutstanding
              ? compact(profile.sharesOutstanding)
              : undefined
          }
        />
        <Field
          label="Employees"
          value={profile?.employees?.toLocaleString("en-GB")}
        />
        <Field label="IPO" value={profile?.ipoDate} />
        <Field label="CIK" value={symbol?.cik} />
        <Field label="Listed" value={symbol?.startDate} />
        {profile?.website ? (
          <div className="col-span-2 min-w-0 md:col-span-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Site
            </div>
            {/* `block` is what makes `truncate` work at all: overflow does not
                apply to an inline box, so a long URL simply ran past the grid
                column instead of ellipsing. */}
            <a
              href={profile.website}
              target="_blank"
              rel="noreferrer"
              className="block truncate hover:underline"
            >
              {profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          </div>
        ) : null}
        {profile?.description ? (
          <p className="col-span-2 pt-1 text-muted-foreground md:col-span-3">
            {profile.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="truncate">{value || "—"}</div>
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
        <div className="hidden w-56 space-y-2 border-r p-3 lg:block">
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
