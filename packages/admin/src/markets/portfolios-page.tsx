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
import { ConfirmButton, ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
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
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import { Stat, StatGroup, type StatTone } from "@repo/ui/stat";
import { Switch } from "@repo/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  Briefcase,
  ChartCandlestick,
  LayoutGrid,
  Plus,
  RefreshCw,
  Table as TableIcon,
  Trash2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

/** Money figures run to twelve characters; the default 7rem column clips them. */
const MONEY_STATS = "sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]";

/** A pane that keeps a long book from pushing the next row off screen. */
const PANE_SCROLL = "max-h-[30rem] overflow-y-auto overscroll-contain";

type NewPortfolioInput = {
  name: string;
  initialCash: number;
  benchmark: string | null;
  inceptionDate: string;
  reinvestDividends: boolean;
  allowShorts: boolean;
  margin: Portfolio["margin"];
};

function statTone(value: number | null | undefined): StatTone {
  if (value === null || value === undefined || value === 0) return "default";
  return value > 0 ? "good" : "critical";
}

function signedPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return undefined;
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

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
  const { client, routes, slots } = useAdmin();
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [selected, setSelected] = useState<string | null>(portfolioId ?? null);
  const [performance, setPerformance] = useState<PortfolioPerformance | null>(
    null,
  );
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);
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
  // exists — a missing `?portfolio=` is the common case, not an error. An id
  // that no longer exists (a stale link to a deleted book) falls back too,
  // rather than leaving a header with no portfolio under it.
  useEffect(() => {
    if (!portfolios || portfolios.length === 0) return;
    if (selected && portfolios.some((item) => item.id === selected)) return;
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
    async (input: NewPortfolioInput) => {
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
    const next = remaining[0]?.id ?? null;
    setSelected(next);
    setPerformance(null);
    setTrades([]);
    setOrders([]);
    // The route still names the deleted id; left alone, a reload would ask
    // for a portfolio that no longer exists.
    if (next) onSelectPortfolio?.(next);
  }, [client, selected, loadPortfolios, onSelectPortfolio]);

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
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Briefcase />}
        crumbs={[{ label: "Markets", href: routes.markets }]}
        title="Portfolios"
      >
        {portfolios.length > 0 ? (
          <Select value={selected ?? undefined} onValueChange={choose}>
            <SelectTrigger size="sm" className="w-36 sm:w-52">
              <SelectValue placeholder="Portfolio" />
            </SelectTrigger>
            <SelectContent>
              {portfolios.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button variant="ghost" size="icon-sm" asChild>
          <a href={routes.markets} aria-label="Markets">
            <ChartCandlestick />
          </a>
        </Button>
        {portfolio ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sync dividends and splits"
            disabled={syncing}
            onClick={() => void sync()}
          >
            <RefreshCw className={cn(syncing && "animate-spin")} />
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
          <Plus />
          New
        </Button>
        {portfolio ? (
          <RowActions label="Portfolio actions">
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmingDelete(true)}
            >
              <Trash2 />
              Delete portfolio
            </DropdownMenuItem>
          </RowActions>
        ) : null}
      </PageHeader>

      <PageBody width="full">
        {!portfolio ? (
          <EmptyState
            icon={<Briefcase />}
            label="No portfolios"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreating(true)}
              >
                <Plus />
                New portfolio
              </Button>
            }
          />
        ) : loading ? (
          <PortfoliosBodySkeleton />
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : !performance ? (
          <EmptyState icon={<Briefcase />} label="—" />
        ) : (
          <>
            <Metrics
              metrics={performance.metrics}
              benchmark={portfolio.benchmark}
            />

            {/* Only shown once the book has a reason for it. A long-only cash
                account has no margin story, and a row of zeroes above the chart
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

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              <Positions
                positions={performance.positions}
                cash={performance.metrics.cash}
                onSelectTicker={selectTicker}
              />
              <Section
                title="Book"
                count={
                  orders.filter(
                    (order) =>
                      order.status === "working" || order.status === "pending",
                  ).length || undefined
                }
                actions={
                  <OrderSheet
                    onSubmit={placeOrder}
                    baseCurrency={portfolio.baseCurrency}
                    positions={performance.positions}
                    margin={performance.margin}
                    marginConfig={portfolio.margin}
                    allowShorts={portfolio.allowShorts}
                  />
                }
              >
                <OrderBlotter
                  orders={orders}
                  onCancel={cancelOrder}
                  onSelectTicker={selectTicker}
                />
              </Section>
              <TradeLog
                trades={trades}
                onAdd={addTrade}
                onDelete={deleteTrade}
                baseCurrency={portfolio.baseCurrency}
                cash={performance.metrics.cash}
                positions={performance.positions}
              />
            </div>
          </>
        )}
      </PageBody>

      <NewPortfolioDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={create}
      />

      {portfolio ? (
        <ConfirmDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title={`Delete ${portfolio.name}?`}
          description="Trades, orders and history go with it."
          actionLabel="Delete"
          destructive
          onConfirm={remove}
        />
      ) : null}
    </Page>
  );
}

function Metrics({
  metrics,
  benchmark,
}: {
  metrics: PortfolioMetrics;
  benchmark: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <StatGroup className={MONEY_STATS}>
        <Stat label="Value" value={money(metrics.totalValue)} />
        <Stat
          label="Day"
          value={signedMoney(metrics.dayPnl)}
          hint={signedPercent(metrics.dayPnlPercent)}
          tone={statTone(metrics.dayPnl)}
        />
        <Stat
          label="Total"
          value={signedMoney(metrics.totalPnl)}
          hint={signedPercent(metrics.totalPnlPercent)}
          tone={statTone(metrics.totalPnl)}
        />
        <Stat label="Cash" value={money(metrics.cash)} />
        <Stat
          label="Realised"
          value={signedMoney(metrics.realizedPnl)}
          tone={statTone(metrics.realizedPnl)}
        />
        <Stat
          label="Unrealised"
          value={signedMoney(metrics.unrealizedPnl)}
          tone={statTone(metrics.unrealizedPnl)}
        />
      </StatGroup>
      <StatGroup>
        <Stat
          label="CAGR"
          value={fracPct(metrics.cagr)}
          tone={statTone(metrics.cagr)}
        />
        <Stat label="Vol" value={fracPct(metrics.volatility)} />
        {/* A drawdown is reported as a positive fraction; negating it keeps the
            sign convention of every other PnL figure. */}
        <Stat
          label="Max DD"
          value={
            metrics.maxDrawdown === null
              ? "—"
              : `-${(metrics.maxDrawdown * 100).toFixed(2)}%`
          }
          tone={metrics.maxDrawdown ? "critical" : "default"}
        />
        <Stat label="Sharpe" value={num(metrics.sharpe)} />
        <Stat label="Sortino" value={num(metrics.sortino)} />
        <Stat label="Beta" value={num(metrics.beta)} />
        <Stat
          label="Alpha"
          value={fracPct(metrics.alpha)}
          tone={statTone(metrics.alpha)}
        />
        <Stat
          label={benchmark ?? "Bench"}
          value={pct(metrics.benchmarkReturn)}
          tone={statTone(metrics.benchmarkReturn)}
        />
        <Stat label="Win" value={pct(metrics.winRate)} />
        <Stat label="Trades" value={String(metrics.tradeCount)} />
      </StatGroup>
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

  return (
    <Section
      title="Positions"
      count={open.length || undefined}
      actions={
        <>
          <span className="text-muted-foreground text-xs tabular-nums">
            Cash {money(cash)}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setView(view === "map" ? "table" : "map")}
            aria-label={view === "map" ? "Show table" : "Show map"}
          >
            {view === "map" ? <TableIcon /> : <LayoutGrid />}
          </Button>
        </>
      }
    >
      {view === "map" ? (
        <PositionTreemap
          positions={positions}
          cash={cash}
          height={280}
          onSelect={onSelectTicker}
        />
      ) : open.length === 0 ? (
        <EmptyState compact label="No positions" />
      ) : (
        <div className={PANE_SCROLL}>
          <Table className="text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-0">Symbol</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                {/* Average cost and weight are the two the owner can recover
                    from the rows either side of them, so they go first when the
                    pane is narrow. */}
                <TableHead className="hidden text-right xl:table-cell">
                  Avg
                </TableHead>
                <TableHead className="text-right">Last</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Day</TableHead>
                <TableHead className="text-right">PnL</TableHead>
                <TableHead className="hidden pr-0 text-right xl:table-cell">
                  Wt
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.map((position) => (
                <TableRow
                  key={position.ticker}
                  onClick={() => onSelectTicker?.(position.ticker)}
                  className="cursor-pointer hover:bg-surface/70"
                >
                  <TableCell className="max-w-28 truncate pl-0 font-medium text-accent-strong">
                    {position.ticker}
                    {position.side === "short" ? (
                      <Badge variant="critical" className="ml-1.5">
                        short
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trimQuantity(position.quantity)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums xl:table-cell">
                    {position.avgCost.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {position.lastPrice?.toFixed(2) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(position.marketValue)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      toneClass(position.dayChangePercent),
                    )}
                  >
                    {signedPercent(position.dayChangePercent) ?? "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      toneClass(position.unrealizedPnl),
                    )}
                  >
                    {signedMoney(position.unrealizedPnl)}
                    <span className="ml-1 text-[10px]">
                      {signedPercent(position.unrealizedPnlPercent, 1)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden pr-0 text-right text-muted-foreground tabular-nums xl:table-cell">
                    {(position.weight * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
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
    <Section
      title="Trades"
      count={ordered.length || undefined}
      actions={
        <TradeSheet
          onSubmit={onAdd}
          baseCurrency={baseCurrency}
          cash={cash}
          positions={positions}
        />
      }
    >
      {ordered.length === 0 ? (
        <EmptyState compact label="No trades" />
      ) : (
        <List className={PANE_SCROLL}>
          {ordered.map((trade) => (
            <ListRow
              key={trade.id}
              title={trade.ticker}
              description={`${trade.executedAt.slice(0, 10)} · ${trimQuantity(
                trade.quantity,
              )} @ ${trade.price.toFixed(2)}${
                trade.fees > 0 ? ` · fee ${trade.fees.toFixed(2)}` : ""
              }`}
              meta={
                <>
                  <SourceBadge source={trade.source} side={trade.side} />
                  {money(trade.quantity * trade.price)}
                </>
              }
              trailing={
                // Generated rows are rebuilt from cached actions, so only what
                // the owner entered can be removed.
                OWNER_ENTERED.has(trade.source) ? (
                  <ConfirmButton
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Delete trade"
                        className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
                      >
                        <Trash2 />
                      </Button>
                    }
                    title={`Delete ${trade.ticker} trade?`}
                    actionLabel="Delete"
                    destructive
                    onConfirm={() => onDelete(trade.id)}
                  />
                ) : (
                  <span className="size-6" />
                )
              }
            />
          ))}
        </List>
      )}
    </Section>
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
    return <Badge variant={side === "buy" ? "good" : "critical"}>{side}</Badge>;
  }
  return <Badge variant="outline">{source}</Badge>;
}

function TicketSheet({
  label,
  title,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="xs">
          <Plus />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="pb-3">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          {children}
        </div>
      </SheetContent>
    </Sheet>
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
    <TicketSheet
      label="Trade"
      title="New trade"
      open={open}
      onOpenChange={setOpen}
    >
      <TradeTicket
        baseCurrency={baseCurrency}
        cash={cash}
        positions={positions}
        onSubmit={onSubmit}
        onDone={() => setOpen(false)}
      />
    </TicketSheet>
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
    <TicketSheet
      label="Order"
      title="New order"
      open={open}
      onOpenChange={setOpen}
    >
      <OrderTicket
        baseCurrency={baseCurrency}
        positions={positions}
        margin={margin}
        marginConfig={marginConfig}
        allowShorts={allowShorts}
        onSubmit={onSubmit}
        onDone={() => setOpen(false)}
      />
    </TicketSheet>
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function NewPortfolioDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewPortfolioInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [initialCash, setInitialCash] = useState("10000");
  const [benchmark, setBenchmark] = useState("SPY");
  const [inceptionDate, setInceptionDate] = useState(today);
  const [reinvest, setReinvest] = useState(false);
  const [allowShorts, setAllowShorts] = useState(false);
  const [useMargin, setUseMargin] = useState(false);
  const [borrowRate, setBorrowRate] = useState("3");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A dialog left open overnight would otherwise default to yesterday.
  useEffect(() => {
    if (open) {
      setInceptionDate(today());
      setProblem(null);
    }
  }, [open]);

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
      onOpenChange(false);
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
    onOpenChange,
  ]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New portfolio"
      onSubmit={submit}
      submitLabel="Create"
      pending={busy}
      footerStart={
        problem ? (
          <span className="truncate text-destructive text-xs">{problem}</span>
        ) : null
      }
    >
      <FormGrid>
        <FormField
          label="Name"
          htmlFor="portfolio-name"
          className="sm:col-span-2"
        >
          <Input
            id="portfolio-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Initial cash" htmlFor="portfolio-cash">
          <Input
            id="portfolio-cash"
            value={initialCash}
            onChange={(event) => setInitialCash(event.target.value)}
            inputMode="decimal"
            className="tabular-nums"
          />
        </FormField>
        <FormField label="Benchmark" htmlFor="portfolio-benchmark">
          <Input
            id="portfolio-benchmark"
            value={benchmark}
            onChange={(event) => setBenchmark(event.target.value)}
            className="uppercase"
          />
        </FormField>
        <FormField label="Inception" htmlFor="portfolio-inception">
          <Input
            id="portfolio-inception"
            type="date"
            value={inceptionDate}
            onChange={(event) => setInceptionDate(event.target.value)}
            className="tabular-nums"
          />
        </FormField>
        <FormField label="Borrow rate %/yr" htmlFor="portfolio-borrow">
          <Input
            id="portfolio-borrow"
            value={borrowRate}
            onChange={(event) => setBorrowRate(event.target.value)}
            inputMode="decimal"
            disabled={!useMargin}
            className="tabular-nums"
          />
        </FormField>
      </FormGrid>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <SwitchField
          id="portfolio-drip"
          label="DRIP"
          checked={reinvest}
          onCheckedChange={setReinvest}
        />
        <SwitchField
          id="portfolio-shorts"
          label="Shorts"
          checked={allowShorts}
          onCheckedChange={setAllowShorts}
        />
        <SwitchField
          id="portfolio-margin"
          label="Margin"
          checked={useMargin}
          onCheckedChange={setUseMargin}
        />
      </div>
    </FormDialog>
  );
}

function SwitchField({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      {label}
    </label>
  );
}

function PortfoliosBodySkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[300px] w-full" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

/** Rendered as a Suspense fallback outside the AdminProvider, so no `useAdmin`. */
export function PortfoliosSkeleton() {
  return (
    <Page>
      <PageHeader icon={<Briefcase />} title="Portfolios">
        <Skeleton className="h-7 w-52" />
      </PageHeader>
      <PageBody width="full">
        <PortfoliosBodySkeleton />
      </PageBody>
    </Page>
  );
}
