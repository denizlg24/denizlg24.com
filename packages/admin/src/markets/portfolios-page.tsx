"use client";

import type {
  MarginState,
  Order,
  OrderInput,
  Portfolio,
  PortfolioMetrics,
  PortfolioPerformance,
  Position,
  Trade,
  TradeSource,
} from "@repo/markets/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { ScrollArea } from "@repo/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import {
  ChartCandlestick,
  LayoutGrid,
  Plus,
  RefreshCw,
  Table as TableIcon,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
import {
  fracPct,
  money,
  num,
  pct,
  signedMoney,
  toneClass,
  trimQuantity,
} from "./format";
import { MarginStrip } from "./margin-strip";
import { OrderBlotter } from "./order-blotter";
import { OrderTicket } from "./order-ticket";
import { PortfolioPerformanceChart } from "./portfolio-performance";
import { PositionTreemap } from "./position-treemap";
import { TradeTicket } from "./trade-ticket";
import { useLiveRefresh } from "./use-live-refresh";

/** Mirrors the delete guard in `apps/web/lib/markets/portfolios.ts`. */
const OWNER_ENTERED = new Set<TradeSource>(["manual", "deposit", "withdrawal"]);

/** Half the server's quote TTL, so a refresh never sits on a stale batch. */
const PERFORMANCE_REFRESH_MS = 60_000;

export interface PortfoliosPageProps {
  /** Passed as a prop, not a route param: desktop is a static export. */
  portfolioId?: string;
  onSelectPortfolio?: (id: string) => void;
  /** Router navigation from the route wrapper; falls back to a full load. */
  onSelectTicker?: (ticker: string) => void;
}

export function PortfoliosPage({
  portfolioId,
  onSelectPortfolio,
  onSelectTicker,
}: PortfoliosPageProps) {
  const { client, routes } = useAdmin();
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [selected, setSelected] = useState<string | null>(portfolioId ?? null);
  const [performance, setPerformance] = useState<PortfolioPerformance | null>(
    null,
  );
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPortfolios = useCallback(
    () =>
      client
        .get<{ portfolios: Portfolio[] }>("/markets/portfolios")
        .then((data) => {
          setPortfolios(data.portfolios);
          return data.portfolios;
        })
        .catch(() => {
          setPortfolios([]);
          return [] as Portfolio[];
        }),
    [client],
  );

  useEffect(() => {
    void loadPortfolios();
  }, [loadPortfolios]);

  useEffect(() => {
    if (portfolioId) setSelected(portfolioId);
  }, [portfolioId]);

  // Fall back to the first portfolio so the surface is never blank while one
  // exists — a missing `?portfolio=` is the common case, not an error.
  useEffect(() => {
    if (selected || !portfolios || portfolios.length === 0) return;
    setSelected(portfolios[0]?.id ?? null);
  }, [portfolios, selected]);

  // The requested id is compared against the current selection on resolve, so
  // switching portfolios mid-flight cannot leave the previous one's performance
  // and trades under the new one's header.
  const requested = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const load = useCallback(
    async (id: string) => {
      // An order or trade mutation on A that resolves after the owner has
      // selected B calls `load(A)`, and `requested` cannot catch that on its
      // own: the stale load overwrites it on the way in and then passes its own
      // check, putting A's book under B's header.
      if (id !== selectedRef.current) return;
      requested.current = id;
      setLoading(true);
      setError(null);
      try {
        const [perf, log, book] = await Promise.all([
          client.get<PortfolioPerformance>(
            `/markets/portfolios/${id}/performance`,
          ),
          client.get<{ trades: Trade[] }>(`/markets/portfolios/${id}/trades`),
          client.get<{ orders: Order[] }>(`/markets/portfolios/${id}/orders`),
        ]);
        if (requested.current !== id) return;
        setPerformance(perf);
        setTrades(log.trades);
        setOrders(book.orders);
      } catch (cause) {
        if (requested.current !== id) return;
        setPerformance(null);
        setTrades([]);
        setOrders([]);
        setError(cause instanceof Error ? cause.message : "Failed to load");
      } finally {
        if (requested.current === id) setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (!selected) {
      setLoading(false);
      return;
    }
    void load(selected);
  }, [selected, load]);

  // Re-price while the page sits open. Holdings that are not on a watchlist
  // have nothing else refreshing their quotes, so without this the value on
  // screen is as old as the last cron run. The route batches one provider
  // request across every holding behind a two-minute TTL, so a tighter poll
  // here costs Mongo reads rather than budget. No loading flag: a quiet
  // re-price must not blank the surface it is updating.
  // Orders ride the same poll. The engine fills on the cron, not in this tab, so
  // without re-reading the book a stop that triggered five minutes ago still
  // shows as working while the position it closed has already gone from the
  // positions table beside it.
  useLiveRefresh(
    () => {
      if (!selected) return;
      Promise.all([
        client.get<PortfolioPerformance>(
          `/markets/portfolios/${selected}/performance`,
        ),
        client.get<{ orders: Order[] }>(
          `/markets/portfolios/${selected}/orders`,
        ),
      ])
        .then(([perf, book]) => {
          if (requested.current !== selected) return;
          setPerformance(perf);
          setOrders(book.orders);
        })
        .catch(() => undefined);
    },
    { intervalMs: PERFORMANCE_REFRESH_MS, enabled: Boolean(selected) },
  );

  const choose = useCallback(
    (id: string) => {
      setSelected(id);
      setConfirmingDelete(false);
      onSelectPortfolio?.(id);
    },
    [onSelectPortfolio],
  );

  const portfolio = portfolios?.find((item) => item.id === selected) ?? null;

  const selectTicker = useCallback(
    (next: string) => {
      if (onSelectTicker) {
        onSelectTicker(next);
        return;
      }
      window.location.href = `${routes.markets}?ticker=${encodeURIComponent(next)}`;
    },
    [onSelectTicker, routes.markets],
  );

  const create = useCallback(
    async (input: {
      name: string;
      initialCash: number;
      benchmark: string | null;
      inceptionDate: string;
      reinvestDividends: boolean;
      allowShorts: boolean;
      margin: Portfolio["margin"];
    }) => {
      const { portfolio: created } = await client.post<{
        portfolio: Portfolio;
      }>("/markets/portfolios", { ...input, baseCurrency: "USD" });
      setPortfolios((current) => [...(current ?? []), created]);
      choose(created.id);
    },
    [client, choose],
  );

  // Deletion takes the trade history with it, so it goes through a confirm
  // step; a rejected request has to say so rather than leave a deleted
  // portfolio on screen behind an unhandled rejection.
  const remove = useCallback(async () => {
    if (!selected) return;
    setConfirmingDelete(false);
    try {
      await client.del(`/markets/portfolios/${selected}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
      return;
    }
    const remaining = await loadPortfolios();
    setSelected(remaining[0]?.id ?? null);
    setPerformance(null);
    setTrades([]);
  }, [client, selected, loadPortfolios]);

  /** Rebuilds dividend and split rows against whatever bars are now cached. */
  const sync = useCallback(async () => {
    if (!selected) return;
    setSyncing(true);
    try {
      await client.post(`/markets/portfolios/${selected}/actions/sync`);
      await load(selected);
    } catch {
      setError("Action sync failed");
    } finally {
      setSyncing(false);
    }
  }, [client, selected, load]);

  const addTrade = useCallback(
    async (input: Record<string, unknown>) => {
      if (!selected) return;
      await client.post(`/markets/portfolios/${selected}/trades`, input);
      await load(selected);
    },
    [client, selected, load],
  );

  const deleteTrade = useCallback(
    async (tradeId: string) => {
      if (!selected) return;
      setTrades((current) => current.filter((trade) => trade.id !== tradeId));
      await client
        .del(`/markets/portfolios/${selected}/trades/${tradeId}`)
        .catch(() => undefined);
      await load(selected);
    },
    [client, selected, load],
  );

  // A rejection is thrown so the ticket can show it against the field the owner
  // is looking at, rather than being swallowed into the page-level error.
  const placeOrder = useCallback(
    async (input: OrderInput) => {
      if (!selected) return;
      await client.post(`/markets/portfolios/${selected}/orders`, input);
      await load(selected);
    },
    [client, selected, load],
  );

  const cancelOrder = useCallback(
    async (orderId: string) => {
      if (!selected) return;
      setOrders((current) =>
        current.map((order) =>
          order.id === orderId
            ? { ...order, status: "cancelled" as const }
            : order,
        ),
      );
      await client
        .del(`/markets/portfolios/${selected}/orders/${orderId}`)
        .catch(() => undefined);
      await load(selected);
    },
    [client, selected, load],
  );

  if (portfolios === null) return <PortfoliosSkeleton />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 sm:flex-nowrap sm:py-0">
        {portfolios.length > 0 ? (
          <Select value={selected ?? undefined} onValueChange={choose}>
            <SelectTrigger size="sm" className="h-8 w-40 text-xs sm:w-56">
              <SelectValue placeholder="Portfolio" />
            </SelectTrigger>
            <SelectContent>
              {portfolios.map((item) => (
                <SelectItem key={item.id} value={item.id} className="text-xs">
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <NewPortfolioSheet onCreate={create} />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href={routes.markets}
            className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
          >
            <ChartCandlestick className="size-3.5" />
            Markets
          </a>
          {portfolio ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={syncing}
                onClick={() => void sync()}
              >
                <RefreshCw
                  className={`size-3 ${syncing ? "animate-spin" : ""}`}
                />
                Actions
              </Button>
              {confirmingDelete ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 max-w-40 px-2 text-red-600 text-xs"
                    onClick={() => void remove()}
                  >
                    <span className="truncate">Delete {portfolio.name}?</span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="size-7 text-muted-foreground"
                    aria-label="Cancel delete"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-red-600"
                  aria-label="Delete portfolio"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {!portfolio ? (
        <div className="px-4 py-3 text-muted-foreground text-xs">—</div>
      ) : loading ? (
        <PortfoliosBodySkeleton />
      ) : error ? (
        <div className="px-4 py-3 text-red-600 text-xs">{error}</div>
      ) : !performance ? (
        <div className="px-4 py-3 text-muted-foreground text-xs">—</div>
      ) : (
        // The dashboard shell clips at the viewport, so a page that outgrows it
        // is cut off rather than scrolled. Below lg the metrics, chart and both
        // panes cannot share one screen, so this column takes the scroll and the
        // panes get a fixed height instead of a share of nothing.
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
          <MetricsRow
            metrics={performance.metrics}
            benchmark={portfolio.benchmark}
          />

          {/* Only shown once the book has a reason for it. A long-only cash
              account has no margin story, and a strip of zeroes above the chart
              is one more row between the owner and the numbers. */}
          {portfolio.margin.enabled ||
          portfolio.allowShorts ||
          performance.margin.shortExposure > 0 ? (
            <MarginStrip
              margin={performance.margin}
              baseCurrency={portfolio.baseCurrency}
            />
          ) : null}

          <PortfolioPerformanceChart
            portfolio={portfolio}
            performance={performance}
          />

          <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-3">
            <Positions
              positions={performance.positions}
              cash={performance.metrics.cash}
              onSelectTicker={selectTicker}
            />
            <div className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
              <div className="flex h-8 shrink-0 items-center justify-between border-b px-4">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Book
                </span>
                <OrderSheet
                  onSubmit={placeOrder}
                  baseCurrency={portfolio.baseCurrency}
                  positions={performance.positions}
                  margin={performance.margin}
                  marginConfig={portfolio.margin}
                  allowShorts={portfolio.allowShorts}
                />
              </div>
              <OrderBlotter
                orders={orders}
                onCancel={cancelOrder}
                onSelectTicker={selectTicker}
              />
            </div>
            <TradeLog
              trades={trades}
              onAdd={addTrade}
              onDelete={deleteTrade}
              baseCurrency={portfolio.baseCurrency}
              cash={performance.metrics.cash}
              positions={performance.positions}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricsRow({
  metrics,
  benchmark,
}: {
  metrics: PortfolioMetrics;
  benchmark: string | null;
}) {
  return (
    <div className="grid shrink-0 grid-cols-3 gap-x-3 gap-y-1 border-b px-4 py-2 text-xs sm:grid-cols-5 sm:gap-x-6 xl:grid-cols-8">
      <Metric label="Value" value={money(metrics.totalValue)} />
      <Metric
        label="Day"
        value={signedMoney(metrics.dayPnl)}
        percent={metrics.dayPnlPercent}
        tone={metrics.dayPnl}
      />
      <Metric
        label="Total"
        value={signedMoney(metrics.totalPnl)}
        percent={metrics.totalPnlPercent}
        tone={metrics.totalPnl}
      />
      <Metric label="Cash" value={money(metrics.cash)} />
      <Metric
        label="Realised"
        value={signedMoney(metrics.realizedPnl)}
        tone={metrics.realizedPnl}
      />
      <Metric
        label="Unrealised"
        value={signedMoney(metrics.unrealizedPnl)}
        tone={metrics.unrealizedPnl}
      />
      <Metric label="CAGR" value={fracPct(metrics.cagr)} tone={metrics.cagr} />
      <Metric label="Vol" value={fracPct(metrics.volatility)} />
      {/* A drawdown is reported as a positive fraction; negating it keeps the
          sign convention of every other PnL figure on the row. */}
      <Metric
        label="Max DD"
        value={
          metrics.maxDrawdown === null
            ? "—"
            : `-${(metrics.maxDrawdown * 100).toFixed(2)}%`
        }
        tone={metrics.maxDrawdown ? -1 : null}
      />
      <Metric label="Sharpe" value={num(metrics.sharpe)} />
      <Metric label="Sortino" value={num(metrics.sortino)} />
      <Metric label="Beta" value={num(metrics.beta)} />
      <Metric
        label="Alpha"
        value={fracPct(metrics.alpha)}
        tone={metrics.alpha}
      />
      <Metric
        label={benchmark ?? "Bench"}
        value={pct(metrics.benchmarkReturn)}
        tone={metrics.benchmarkReturn}
      />
      <Metric label="Win" value={pct(metrics.winRate)} />
      <Metric label="Trades" value={String(metrics.tradeCount)} />
    </div>
  );
}

function Metric({
  label,
  value,
  percent,
  tone,
}: {
  label: string;
  value: string;
  percent?: number | null;
  tone?: number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className={`truncate tabular-nums ${toneClass(tone)}`}>
        {value}
        {percent !== undefined && percent !== null ? (
          <span className="ml-1 text-[10px]">
            {percent >= 0 ? "+" : ""}
            {percent.toFixed(2)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Positions({
  positions,
  cash,
  onSelectTicker,
}: {
  positions: Position[];
  cash: number;
  onSelectTicker?: (ticker: string) => void;
}) {
  // Everything held, either way round. Filtering to `> 0` would hide every
  // short from the only table that lists what the portfolio actually owns.
  const open = positions.filter((position) => position.quantity !== 0);
  const [view, setView] = useState<"map" | "table">("map");

  // Tall enough below lg to hold the 280px treemap plus its header.
  return (
    <div className="flex h-[22rem] min-h-0 flex-col border-b lg:h-auto lg:border-r lg:border-b-0">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-4 text-[10px] text-muted-foreground uppercase tracking-wide">
        <span>Positions</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="tabular-nums">Cash {money(cash)}</span>
          <button
            type="button"
            onClick={() => setView(view === "map" ? "table" : "map")}
            aria-label={view === "map" ? "Show table" : "Show map"}
            className="rounded p-0.5 hover:text-foreground"
          >
            {view === "map" ? (
              <TableIcon className="size-3.5" />
            ) : (
              <LayoutGrid className="size-3.5" />
            )}
          </button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollbars="both">
        {view === "map" ? (
          <div className="p-2">
            <PositionTreemap
              positions={positions}
              cash={cash}
              height={280}
              onSelect={onSelectTicker}
            />
          </div>
        ) : open.length === 0 ? (
          <div className="px-4 py-2 text-muted-foreground text-xs">—</div>
        ) : (
          <table className="w-full text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
              <tr className="border-b">
                <th className="px-3 py-1 text-left font-normal">Symbol</th>
                <th className="px-1.5 py-1 text-right font-normal">Qty</th>
                {/* Average cost and weight are the two the owner can recover
                    from the rows either side of them, so they go first when the
                    pane is narrow. */}
                <th className="hidden px-1.5 py-1 text-right font-normal xl:table-cell">
                  Avg
                </th>
                <th className="px-1.5 py-1 text-right font-normal">Last</th>
                <th className="px-1.5 py-1 text-right font-normal">Value</th>
                <th className="px-1.5 py-1 text-right font-normal">Day</th>
                <th className="px-1.5 py-1 text-right font-normal">PnL</th>
                <th className="hidden px-3 py-1 text-right font-normal xl:table-cell">
                  Wt
                </th>
              </tr>
            </thead>
            <tbody>
              {open.map((position) => (
                <tr
                  key={position.ticker}
                  onClick={() => onSelectTicker?.(position.ticker)}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/50"
                >
                  <td className="max-w-28 truncate px-3 py-1 font-medium">
                    {position.ticker}
                    {position.side === "short" ? (
                      <span className="ml-1 text-[9px] text-red-600 uppercase">
                        short
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {trimQuantity(position.quantity)}
                  </td>
                  <td className="hidden px-1.5 py-1 text-right tabular-nums xl:table-cell">
                    {position.avgCost.toFixed(2)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {position.lastPrice?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {money(position.marketValue)}
                  </td>
                  <td
                    className={`px-1.5 py-1 text-right tabular-nums ${toneClass(
                      position.dayChangePercent,
                    )}`}
                  >
                    {position.dayChangePercent === null
                      ? "—"
                      : `${position.dayChangePercent >= 0 ? "+" : ""}${position.dayChangePercent.toFixed(2)}%`}
                  </td>
                  <td
                    className={`px-1.5 py-1 text-right tabular-nums ${toneClass(
                      position.unrealizedPnl,
                    )}`}
                  >
                    {signedMoney(position.unrealizedPnl)}
                    <span className="ml-1 text-[10px]">
                      {position.unrealizedPnlPercent >= 0 ? "+" : ""}
                      {position.unrealizedPnlPercent.toFixed(1)}%
                    </span>
                  </td>
                  <td className="hidden px-3 py-1 text-right text-muted-foreground tabular-nums xl:table-cell">
                    {(position.weight * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}

function TradeLog({
  trades,
  onAdd,
  onDelete,
  baseCurrency,
  cash,
  positions,
}: {
  trades: Trade[];
  onAdd: (input: Record<string, unknown>) => Promise<void>;
  onDelete: (tradeId: string) => Promise<void>;
  baseCurrency: string;
  cash: number;
  positions: Position[];
}) {
  const ordered = useMemo(
    () => [...trades].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)),
    [trades],
  );

  return (
    <div className="flex h-80 min-h-0 flex-col lg:h-auto">
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-4">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Trades
        </span>
        <TradeSheet
          onSubmit={onAdd}
          baseCurrency={baseCurrency}
          cash={cash}
          positions={positions}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollbars="both">
        {ordered.length === 0 ? (
          <div className="px-4 py-2 text-muted-foreground text-xs">—</div>
        ) : (
          // No `min-w`: an arbitrary floor is what forced this to scroll
          // sideways in a pane narrower than the guess. `whitespace-nowrap` lets
          // the browser compute the table's real minimum from its content, so it
          // scrolls only when it genuinely cannot fit.
          <table className="w-full text-xs [&_td]:whitespace-nowrap">
            <tbody>
              {ordered.map((trade) => (
                <tr
                  key={trade.id}
                  className="group border-b last:border-b-0 hover:bg-muted/50"
                >
                  <td className="px-3 py-1 text-muted-foreground tabular-nums">
                    {trade.executedAt.slice(0, 10)}
                  </td>
                  <td className="py-1">
                    <SourceBadge source={trade.source} side={trade.side} />
                  </td>
                  <td className="max-w-24 truncate px-1.5 py-1 font-medium">
                    {trade.ticker}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {trimQuantity(trade.quantity)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {trade.price.toFixed(2)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {money(trade.quantity * trade.price)}
                  </td>
                  {/* Fees are almost always zero here and are the first thing
                      worth losing when the pane is narrow. */}
                  <td className="hidden px-1.5 py-1 text-right text-muted-foreground tabular-nums xl:table-cell">
                    {trade.fees > 0 ? trade.fees.toFixed(2) : ""}
                  </td>
                  <td className="w-8 px-1.5 py-1 text-right">
                    {/* Generated rows are rebuilt from cached actions, so only
                        what the owner entered can be removed. */}
                    {OWNER_ENTERED.has(trade.source) ? (
                      <button
                        type="button"
                        aria-label="Delete trade"
                        onClick={() => void onDelete(trade.id)}
                        className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-red-600 group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}

function SourceBadge({
  source,
  side,
}: {
  source: TradeSource;
  side: "buy" | "sell";
}) {
  if (source === "manual") {
    return (
      <span
        className={`text-[10px] uppercase ${
          side === "buy" ? "text-emerald-600" : "text-red-600"
        }`}
      >
        {side}
      </span>
    );
  }
  return (
    <Badge variant="outline" className="px-1 py-0 text-[9px] uppercase">
      {source}
    </Badge>
  );
}

function TradeSheet({
  onSubmit,
  baseCurrency,
  cash,
  positions,
}: {
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
  baseCurrency: string;
  cash: number;
  positions: Position[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
          <Plus className="size-3" />
          Trade
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle className="text-sm">New trade</SheetTitle>
        </SheetHeader>
        <div className="px-4">
          <TradeTicket
            baseCurrency={baseCurrency}
            cash={cash}
            positions={positions}
            onSubmit={onSubmit}
            onDone={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OrderSheet({
  onSubmit,
  baseCurrency,
  positions,
  margin,
  marginConfig,
  allowShorts,
}: {
  onSubmit: (input: OrderInput) => Promise<void>;
  baseCurrency: string;
  positions: Position[];
  margin: MarginState;
  marginConfig: Portfolio["margin"];
  allowShorts: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
          <Plus className="size-3" />
          Order
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle className="text-sm">New order</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <OrderTicket
            baseCurrency={baseCurrency}
            positions={positions}
            margin={margin}
            marginConfig={marginConfig}
            allowShorts={allowShorts}
            onSubmit={onSubmit}
            onDone={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NewPortfolioSheet({
  onCreate,
}: {
  onCreate: (input: {
    name: string;
    initialCash: number;
    benchmark: string | null;
    inceptionDate: string;
    reinvestDividends: boolean;
    allowShorts: boolean;
    margin: Portfolio["margin"];
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [initialCash, setInitialCash] = useState("10000");
  const [benchmark, setBenchmark] = useState("SPY");
  const [inceptionDate, setInceptionDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reinvest, setReinvest] = useState(false);
  const [allowShorts, setAllowShorts] = useState(false);
  const [useMargin, setUseMargin] = useState(false);
  const [borrowRate, setBorrowRate] = useState("3");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      setProblem("Name required");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onCreate({
        name: name.trim(),
        initialCash: Number(initialCash) || 0,
        benchmark: benchmark.trim().toUpperCase() || null,
        inceptionDate,
        reinvestDividends: reinvest,
        allowShorts,
        margin: {
          enabled: useMargin,
          initialLong: 0.5,
          initialShort: 1.5,
          maintenanceLong: 0.25,
          maintenanceShort: 0.3,
          borrowRate: (Number(borrowRate) || 0) / 100,
        },
      });
      setName("");
      setOpen(false);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [
    name,
    initialCash,
    benchmark,
    inceptionDate,
    reinvest,
    allowShorts,
    useMargin,
    borrowRate,
    onCreate,
  ]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 px-2 text-xs">
          <Plus className="size-3" />
          New
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle className="text-sm">New portfolio</SheetTitle>
        </SheetHeader>

        <div className="space-y-3 px-4 text-xs">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Initial cash</Label>
              <Input
                value={initialCash}
                onChange={(event) => setInitialCash(event.target.value)}
                inputMode="decimal"
                className="h-8 text-xs tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Benchmark</Label>
              <Input
                value={benchmark}
                onChange={(event) => setBenchmark(event.target.value)}
                className="h-8 text-xs uppercase"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Inception</Label>
            <Input
              type="date"
              value={inceptionDate}
              onChange={(event) => setInceptionDate(event.target.value)}
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Label htmlFor="portfolio-drip" className="text-xs">
              <Switch
                id="portfolio-drip"
                checked={reinvest}
                onCheckedChange={setReinvest}
              />
              DRIP
            </Label>
            <Label htmlFor="portfolio-shorts" className="text-xs">
              <Switch
                id="portfolio-shorts"
                checked={allowShorts}
                onCheckedChange={setAllowShorts}
              />
              Shorts
            </Label>
            <Label htmlFor="portfolio-margin" className="text-xs">
              <Switch
                id="portfolio-margin"
                checked={useMargin}
                onCheckedChange={setUseMargin}
              />
              Margin
            </Label>
          </div>
          {useMargin ? (
            <div className="space-y-1">
              <Label className="text-xs">Borrow rate %/yr</Label>
              <Input
                value={borrowRate}
                onChange={(event) => setBorrowRate(event.target.value)}
                inputMode="decimal"
                className="h-8 text-xs tabular-nums"
              />
            </div>
          ) : null}
          {problem ? <div className="text-red-600">{problem}</div> : null}
        </div>

        <SheetFooter>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => void submit()}
          >
            Create
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PortfoliosBodySkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-[240px] w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function PortfoliosSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-16" />
      </div>
      <PortfoliosBodySkeleton />
    </div>
  );
}
