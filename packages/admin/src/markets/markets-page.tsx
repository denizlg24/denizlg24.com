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
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListGroupLabel, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { FilterTabs, ToolbarSpacer } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  CandlestickChart,
  FileText,
  ListTree,
  Plus,
  RefreshCw,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { CandleChart, type ChartKind, type Overlay } from "./candle-chart";
import { toneClass } from "./format";
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

const INDICATOR_COLOR = Object.fromEntries(
  INDICATORS.map((indicator) => [indicator.key, indicator.color]),
) as Record<IndicatorKey, string>;

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
  const { client, routes, slots } = useAdmin();
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
      result.push({
        key: "sma20",
        color: INDICATOR_COLOR.sma20,
        values: sma(closes, 20),
      });
    }
    if (active.has("sma50")) {
      result.push({
        key: "sma50",
        color: INDICATOR_COLOR.sma50,
        values: sma(closes, 50),
      });
    }
    if (active.has("ema200")) {
      result.push({
        key: "ema200",
        color: INDICATOR_COLOR.ema200,
        values: ema(closes, 200),
      });
    }
    if (active.has("bb")) {
      const bands = bollinger(closes, 20, 2);
      result.push(
        { key: "bbUpper", color: INDICATOR_COLOR.bb, values: bands.upper },
        { key: "bbLower", color: INDICATOR_COLOR.bb, values: bands.lower },
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

  const watchlistPanel =
    watchlists.length === 0 ? (
      <EmptyState compact icon={<Star />} label="No watchlists" />
    ) : (
      <List>
        {watchlists.map((list) => (
          <div key={list.id}>
            <ListGroupLabel className="px-2">{list.name}</ListGroupLabel>
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
        ))}
      </List>
    );

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<CandlestickChart />}
        title="Markets"
      >
        <div className="mr-1 hidden items-center gap-3 sm:flex">
          <SessionIndicator session={session} />
          <TransportIndicator transport={transport} upstream={upstream} />
          {series?.freshness.stale ? (
            <Badge variant="warning">stale</Badge>
          ) : null}
          {budget ? <BudgetReadout budget={budget} /> : null}
        </div>
        {universe === 0 ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={seeding}
            onClick={() => void seed()}
          >
            <RefreshCw className={cn(seeding && "animate-spin")} />
            Seed universe
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" asChild>
          <a href={routes.portfolios}>
            <Wallet />
            <span className="hidden sm:inline">Portfolios</span>
          </a>
        </Button>
      </PageHeader>

      <PageToolbar>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="lg:hidden"
              aria-label="Watchlists"
            >
              <ListTree />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 p-0">
            <SheetHeader className="border-b p-3 pr-12">
              <SheetTitle>Watchlists</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {watchlistPanel}
            </div>
          </SheetContent>
        </Sheet>
        <SymbolSearch onSelect={choose} className="w-56" />
        <FilterTabs
          value={range.label}
          onChange={(value) => {
            const next = RANGES.find((item) => item.label === value);
            if (next) setRange(next);
          }}
          options={RANGES.map((item) => ({
            value: item.label,
            label: item.label,
          }))}
        />
        <FilterTabs<ChartKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: "candles", label: "Candles" },
            { value: "area", label: "Line" },
          ]}
        />
        <ToolbarSpacer />
        <div className="flex flex-wrap items-center gap-0.5">
          {INDICATORS.map((indicator) => {
            const on = active.has(indicator.key);
            return (
              <Button
                key={indicator.key}
                size="sm"
                variant="ghost"
                aria-pressed={on}
                className={cn(
                  "text-muted-foreground",
                  on && "bg-surface text-accent-strong dark:bg-muted",
                )}
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
                  className={cn(
                    "inline-block size-2 rounded-full",
                    !on && "opacity-40",
                  )}
                  style={{ background: indicator.color }}
                />
                {indicator.label}
              </Button>
            );
          })}
        </div>
      </PageToolbar>

      <PageBody bleed className="flex">
        <aside className="hidden w-60 shrink-0 overflow-y-auto overscroll-contain border-r p-2 lg:block">
          {watchlistPanel}
        </aside>

        {/* Scrolls at every width. `lg:overflow-hidden` assumed the quote strip,
            chart and detail panel always fit above lg; on a short window they do
            not, and what did not fit could not be reached. */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <CompanyLogo
                url={detail?.profile?.logoUrl}
                name={detail?.profile?.name ?? selected}
                size={24}
              />
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="font-semibold text-accent-strong text-lg">
                  {selected}
                </span>
                {detail?.symbol ? (
                  <span className="hidden max-w-64 truncate text-muted-foreground text-xs sm:inline">
                    {detail.symbol.name}
                  </span>
                ) : null}
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={watching ? "Unwatch" : "Watch"}
                aria-pressed={watching}
                className={cn(
                  watching ? "text-status-warning" : "text-muted-foreground",
                )}
                onClick={() => void toggleWatch(selected)}
              >
                {watching ? <Star className="fill-current" /> : <Plus />}
              </Button>
              <div className="flex items-baseline gap-2">
                <span className="font-calistoga text-2xl text-accent-strong tabular-nums leading-none">
                  {last === null ? "—" : last.toFixed(2)}
                </span>
                {change !== null && changePercent !== null ? (
                  <span
                    className={cn("text-sm tabular-nums", toneClass(change))}
                  >
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(2)} ({changePercent.toFixed(2)}%)
                  </span>
                ) : null}
              </div>
              <div className="ml-auto">
                <QuickTrade ticker={selected} lastPrice={last} />
              </div>
            </div>
            <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <Figure label="Open" value={fixed(sessionStats.open)} />
              <Figure label="High" value={fixed(sessionStats.high)} />
              <Figure label="Low" value={fixed(sessionStats.low)} />
              <Figure label="Prev" value={fixed(sessionStats.close)} />
              <Figure
                label="Vol"
                value={
                  sessionStats.volume === undefined
                    ? "—"
                    : compact(sessionStats.volume)
                }
              />
              <Figure label="RSI" value={fixed(strength ?? undefined, 1)} />
              {detail?.profile?.marketCap ? (
                <Figure label="Cap" value={compact(detail.profile.marketCap)} />
              ) : null}
              {detail?.profile?.sector ? (
                <Figure label="Sector" value={detail.profile.sector} />
              ) : null}
            </dl>
          </div>

          {/* Below lg the chart takes a definite height and the column scrolls,
              rather than every pane splitting one phone screen between them.
              Definite rather than a minimum: the chart fills its container, and
              a `flex-1` box inside a scrolling column has no height to fill. */}
          <div className="h-72 shrink-0 px-2 py-2 lg:h-auto lg:min-h-72 lg:flex-1 lg:shrink">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : error ? (
              <EmptyState
                icon={<CandlestickChart />}
                label={<span className="text-destructive">{error}</span>}
                className="h-full"
              />
            ) : bars.length === 0 ? (
              <EmptyState
                icon={<CandlestickChart />}
                label="No bars"
                className="h-full"
              />
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
      </PageBody>
    </Page>
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
        className="flex shrink-0 items-center justify-center rounded bg-surface font-medium text-[10px] text-muted-foreground dark:bg-muted"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  // The white plate is deliberate: most marks are drawn for a light background
  // and vanish against the dark theme without one.
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

function fixed(value: number | undefined, digits = 2): string {
  return value === undefined ? "—" : value.toFixed(digits);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
        {label}
      </dt>
      <dd className="max-w-40 truncate text-accent-strong text-xs tabular-nums">
        {value}
      </dd>
    </div>
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
    <ListRow
      selected={active}
      onClick={() => onSelect(ticker)}
      className="mx-0 min-h-8 py-1"
      title={<span className="font-medium text-xs">{ticker}</span>}
      meta={
        <>
          <span className="text-accent-strong">
            {quote?.last?.toFixed(2) ?? "—"}
          </span>
          <span className={cn("w-14 text-right", toneClass(change))}>
            {change === null
              ? "—"
              : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
          </span>
        </>
      }
      trailing={
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Remove ${ticker}`}
          className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X />
        </Button>
      }
    />
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

function Dot({ className }: { className: string }) {
  return (
    <span className={cn("inline-block size-1.5 rounded-full", className)} />
  );
}

function SessionIndicator({ session }: { session: MarketSession }) {
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
      <Dot
        className={
          session.state === "open"
            ? "bg-status-good"
            : session.state === "closed"
              ? "bg-muted-foreground"
              : "bg-status-warning"
        }
      />
      {session.state}
      {relative ? <span className="hidden md:inline">{relative}</span> : null}
      {session.earlyClose ? (
        <span className="hidden text-status-warning lg:inline">½</span>
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

function TransportIndicator({
  transport,
  upstream,
}: {
  transport: "ws" | "poll";
  upstream: "connected" | "connecting" | "disconnected" | null;
}) {
  const live = transport === "ws" && upstream === "connected";
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <Dot
        className={
          live
            ? "bg-status-good"
            : transport === "ws"
              ? "bg-status-warning"
              : "bg-muted-foreground"
        }
      />
      {live ? "live" : transport === "ws" ? (upstream ?? "…") : "poll"}
    </span>
  );
}

function BudgetReadout({ budget }: { budget: ProviderBudget }) {
  const hour = budget.hourUsed / budget.hourLimit;
  const day = budget.dayUsed / budget.dayLimit;
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        hour > 0.8 || day > 0.8
          ? "text-status-warning"
          : "text-muted-foreground",
      )}
    >
      {budget.hourUsed}/{budget.hourLimit}h · {budget.dayUsed}/{budget.dayLimit}
      d
    </span>
  );
}

type DetailTab = "company" | "fundamentals" | "filings" | "actions" | "news";

const DETAIL_TABS: { value: DetailTab; label: string }[] = [
  { value: "company", label: "Company" },
  { value: "fundamentals", label: "Fundamentals" },
  { value: "filings", label: "Filings" },
  { value: "actions", label: "Actions" },
  { value: "news", label: "News" },
];

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
  const income = latest
    ? latest.facts.filter((fact) => fact.statement === "income").slice(0, 8)
    : [];
  const sortedActions = [...actions].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="flex h-60 shrink-0 flex-col border-t max-lg:h-72">
      {/* `pb-1.5` is not spacing. The line-variant trigger paints its active
          underline at `bottom-[-5px]`, five pixels below the list's own box, and
          `overflow-x-auto` here forces overflow-y to non-visible — so with no
          bottom padding the underline was clipped and the strip grew a scrollbar
          for the couple of pixels it could not contain. */}
      <div className="flex shrink-0 items-center overflow-x-auto px-4 pt-1 pb-1.5 sm:px-5">
        <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
          <TabsList variant="line" className="h-7">
            {DETAIL_TABS.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="px-2 text-xs"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
        {tab === "company" ? (
          <Company ticker={ticker} symbol={symbol} profile={profile} />
        ) : tab === "fundamentals" ? (
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
            <Properties>
              <Ratio label="P/E" value={ratios?.peRatio} />
              <Ratio label="P/B" value={ratios?.priceToBook} />
              <Ratio label="P/S" value={ratios?.priceToSales} />
              <Ratio label="EPS" value={ratios?.eps} />
              <Ratio label="Gross margin" value={ratios?.grossMargin} percent />
              <Ratio label="Net margin" value={ratios?.netMargin} percent />
              <Ratio label="ROE" value={ratios?.returnOnEquity} percent />
              <Ratio label="D/E" value={ratios?.debtToEquity} />
            </Properties>
            {latest ? (
              <Section
                title={`${latest.form} · ${latest.fiscalPeriod} ${latest.fiscalYear}`}
                actions={
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {latest.periodEnd}
                  </span>
                }
              >
                <Properties>
                  {income.map((fact) => (
                    <Property key={fact.key} label={fact.label}>
                      <span className="tabular-nums">
                        {compact(fact.value)}
                      </span>
                    </Property>
                  ))}
                </Properties>
              </Section>
            ) : (
              <EmptyState compact label="No reported periods" />
            )}
          </div>
        ) : tab === "filings" ? (
          filings.length === 0 ? (
            <EmptyState compact label="No filings" />
          ) : (
            <List>
              {filings.map((filing) => (
                <a
                  key={filing.accession}
                  href={filing.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ListRow
                    className="min-h-8 py-1"
                    leading={<FileText />}
                    title={<span className="font-medium">{filing.form}</span>}
                    meta={
                      <>
                        <span className="hidden sm:inline">
                          {filing.accession}
                        </span>
                        <span>{filing.filed}</span>
                      </>
                    }
                  />
                </a>
              ))}
            </List>
          )
        ) : tab === "actions" ? (
          sortedActions.length === 0 ? (
            <EmptyState compact label="No corporate actions" />
          ) : (
            <List>
              {sortedActions.map((action) => (
                <ListRow
                  key={`${action.date}:${action.divCash}:${action.splitFactor}`}
                  className="min-h-8 py-1"
                  title={
                    <span className="flex gap-3 tabular-nums">
                      {action.divCash !== 0 ? (
                        <span>Dividend {action.divCash.toFixed(4)}</span>
                      ) : null}
                      {action.splitFactor !== 1 ? (
                        <span>Split ×{action.splitFactor}</span>
                      ) : null}
                    </span>
                  }
                  meta={action.date}
                />
              ))}
            </List>
          )
        ) : news.length === 0 ? (
          <EmptyState compact label="No news" />
        ) : (
          <List>
            {news.map((item) => (
              <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
                <ListRow
                  className="min-h-8 py-1"
                  title={item.headline}
                  meta={
                    <>
                      <span className="hidden max-w-32 truncate sm:inline">
                        {item.source}
                      </span>
                      <span>
                        {item.publishedAt.slice(5, 16).replace("T", " ")}
                      </span>
                    </>
                  }
                />
              </a>
            ))}
          </List>
        )}
      </div>
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
    return <EmptyState compact label="No profile" />;
  }

  const website = profile?.website;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        <CompanyLogo
          url={profile?.logoUrl}
          name={profile?.name ?? symbol?.name ?? ticker}
          size={40}
        />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-10 md:grid-cols-2">
          <Properties>
            <Field label="Name" value={profile?.name ?? symbol?.name} />
            <Field label="Exchange" value={symbol?.exchange} />
            <Field label="Type" value={symbol?.assetType} />
            <Field label="Sector" value={profile?.sector} />
            <Field label="Country" value={profile?.country} />
            <Field label="Currency" value={symbol?.currency} />
            {website ? (
              <Property label="Site">
                {/* `block` is what makes `truncate` work at all: overflow does
                    not apply to an inline box, so a long URL simply ran past the
                    column instead of ellipsing. */}
                <a
                  href={website}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate hover:underline"
                >
                  {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </Property>
            ) : null}
          </Properties>
          <Properties>
            <Field
              label="Market cap"
              value={
                profile?.marketCap ? compact(profile.marketCap) : undefined
              }
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
          </Properties>
        </div>
      </div>
      {profile?.description ? (
        <p className="max-w-3xl text-muted-foreground text-xs leading-relaxed">
          {profile.description}
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <Property label={label} className="min-h-7 text-xs">
      <span className="block truncate">{value || "—"}</span>
    </Property>
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
    <Property label={label} className="min-h-7 text-xs">
      <span className="tabular-nums">
        {value === null || value === undefined
          ? "—"
          : percent
            ? `${(value * 100).toFixed(1)}%`
            : value.toFixed(2)}
      </span>
    </Property>
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
    <Page>
      <PageHeader icon={<CandlestickChart />} title="Markets" />
      <PageToolbar>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-7 w-32" />
      </PageToolbar>
      <PageBody bleed className="flex">
        <div className="hidden w-60 shrink-0 flex-col gap-2 border-r p-3 lg:flex">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={`row-${i}`} className="h-5 w-full" />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4 sm:px-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-6" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="min-h-72 w-full flex-1" />
          <Skeleton className="h-48 w-full" />
        </div>
      </PageBody>
    </Page>
  );
}
