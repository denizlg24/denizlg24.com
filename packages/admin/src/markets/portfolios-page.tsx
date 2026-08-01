"use client";

import { CASH_TICKER } from "@repo/markets/core";
import type {
  Portfolio,
  PortfolioMetrics,
  PortfolioPerformance,
  Position,
  Quote,
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
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { CandlestickChart, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { type CurveSeries, EquityChart } from "./equity-chart";
import { SymbolSearch } from "./symbol-search";

const PORTFOLIO_COLOR = "#2563eb";
const BENCHMARK_COLOR = "#94a3b8";

export interface PortfoliosPageProps {
  /** Passed as a prop, not a route param: desktop is a static export. */
  portfolioId?: string;
  onSelectPortfolio?: (id: string) => void;
}

export function PortfoliosPage({
  portfolioId,
  onSelectPortfolio,
}: PortfoliosPageProps) {
  const { client, routes } = useAdmin();
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [selected, setSelected] = useState<string | null>(portfolioId ?? null);
  const [performance, setPerformance] = useState<PortfolioPerformance | null>(
    null,
  );
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [normalize, setNormalize] = useState(true);
  const [syncing, setSyncing] = useState(false);
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

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const [perf, log] = await Promise.all([
          client.get<PortfolioPerformance>(
            `/markets/portfolios/${id}/performance`,
          ),
          client.get<{ trades: Trade[] }>(`/markets/portfolios/${id}/trades`),
        ]);
        setPerformance(perf);
        setTrades(log.trades);
      } catch (cause) {
        setPerformance(null);
        setTrades([]);
        setError(cause instanceof Error ? cause.message : "Failed to load");
      } finally {
        setLoading(false);
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

  const choose = useCallback(
    (id: string) => {
      setSelected(id);
      onSelectPortfolio?.(id);
    },
    [onSelectPortfolio],
  );

  const portfolio = portfolios?.find((item) => item.id === selected) ?? null;

  const create = useCallback(
    async (input: {
      name: string;
      initialCash: number;
      benchmark: string | null;
      inceptionDate: string;
      reinvestDividends: boolean;
    }) => {
      const { portfolio: created } = await client.post<{
        portfolio: Portfolio;
      }>("/markets/portfolios", { ...input, baseCurrency: "USD" });
      setPortfolios((current) => [...(current ?? []), created]);
      choose(created.id);
    },
    [client, choose],
  );

  const remove = useCallback(async () => {
    if (!selected) return;
    await client.del(`/markets/portfolios/${selected}`);
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

  const series = useMemo<CurveSeries[]>(() => {
    if (!performance || performance.curve.length === 0) return [];
    const result: CurveSeries[] = [
      {
        key: "portfolio",
        color: PORTFOLIO_COLOR,
        points: performance.curve.map((point) => ({
          date: point.date,
          value: point.value,
        })),
      },
    ];
    // The benchmark is only comparable once both are rebased; on an absolute
    // axis an index level would flatten the portfolio into the baseline.
    if (normalize && performance.benchmarkCurve.length > 0) {
      const start = performance.curve[0]?.date ?? "";
      result.push({
        key: "benchmark",
        color: BENCHMARK_COLOR,
        points: performance.benchmarkCurve.filter(
          (point) => point.date >= start,
        ),
      });
    }
    return result;
  }, [performance, normalize]);

  if (portfolios === null) return <PortfoliosSkeleton />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        {portfolios.length > 0 ? (
          <Select value={selected ?? undefined} onValueChange={choose}>
            <SelectTrigger size="sm" className="h-8 w-56 text-xs">
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

        <div className="ml-auto flex items-center gap-2">
          <a
            href={routes.markets}
            className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
          >
            <CandlestickChart className="size-3.5" />
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
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-red-600"
                aria-label="Delete portfolio"
                onClick={() => void remove()}
              >
                <Trash2 className="size-3.5" />
              </Button>
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
        <div className="flex min-h-0 flex-1 flex-col">
          <MetricsRow
            metrics={performance.metrics}
            benchmark={portfolio.benchmark}
          />

          <div className="shrink-0 border-b">
            <div className="flex items-center gap-3 px-4 pt-2 text-xs">
              <Legend color={PORTFOLIO_COLOR} label={portfolio.name} />
              {normalize && portfolio.benchmark ? (
                <Legend color={BENCHMARK_COLOR} label={portfolio.benchmark} />
              ) : null}
              <Label
                htmlFor="curve-normalize"
                className="ml-auto text-muted-foreground text-xs"
              >
                <Switch
                  id="curve-normalize"
                  checked={normalize}
                  onCheckedChange={setNormalize}
                  className="scale-90"
                />
                %
              </Label>
            </div>
            <div className="px-2 pb-2">
              {series.length === 0 ? (
                <div className="px-2 py-8 text-muted-foreground text-xs">—</div>
              ) : (
                <EquityChart
                  series={series}
                  normalize={normalize}
                  height={240}
                  fitKey={`${portfolio.id}:${normalize}`}
                />
              )}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
            <Positions
              positions={performance.positions}
              cash={performance.metrics.cash}
            />
            <TradeLog
              trades={trades}
              onAdd={addTrade}
              onDelete={deleteTrade}
              baseCurrency={portfolio.baseCurrency}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        className="inline-block h-0.5 w-3 rounded"
        style={{ background: color }}
      />
      {label}
    </span>
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
    <div className="grid shrink-0 grid-cols-3 gap-x-6 gap-y-1 border-b px-4 py-2 text-xs sm:grid-cols-5 xl:grid-cols-8">
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
}: {
  positions: Position[];
  cash: number;
}) {
  const open = positions.filter((position) => position.quantity > 0);

  return (
    <div className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-4 text-[10px] text-muted-foreground uppercase tracking-wide">
        <span>Positions</span>
        <span className="tabular-nums">Cash {money(cash)}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {open.length === 0 ? (
          <div className="px-4 py-2 text-muted-foreground text-xs">—</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
              <tr className="border-b">
                <th className="px-4 py-1 text-left font-normal">Symbol</th>
                <th className="px-2 py-1 text-right font-normal">Qty</th>
                <th className="px-2 py-1 text-right font-normal">Avg</th>
                <th className="px-2 py-1 text-right font-normal">Last</th>
                <th className="px-2 py-1 text-right font-normal">Value</th>
                <th className="px-2 py-1 text-right font-normal">Day</th>
                <th className="px-2 py-1 text-right font-normal">PnL</th>
                <th className="px-4 py-1 text-right font-normal">Wt</th>
              </tr>
            </thead>
            <tbody>
              {open.map((position) => (
                <tr
                  key={position.ticker}
                  className="border-b last:border-b-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-1 font-medium">{position.ticker}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {trimQuantity(position.quantity)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {position.avgCost.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {position.lastPrice?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {money(position.marketValue)}
                  </td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${toneClass(
                      position.dayChangePercent,
                    )}`}
                  >
                    {position.dayChangePercent === null
                      ? "—"
                      : `${position.dayChangePercent >= 0 ? "+" : ""}${position.dayChangePercent.toFixed(2)}%`}
                  </td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${toneClass(
                      position.unrealizedPnl,
                    )}`}
                  >
                    {signedMoney(position.unrealizedPnl)}
                    <span className="ml-1 text-[10px]">
                      {position.unrealizedPnlPercent >= 0 ? "+" : ""}
                      {position.unrealizedPnlPercent.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-1 text-right text-muted-foreground tabular-nums">
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
}: {
  trades: Trade[];
  onAdd: (input: Record<string, unknown>) => Promise<void>;
  onDelete: (tradeId: string) => Promise<void>;
  baseCurrency: string;
}) {
  const ordered = useMemo(
    () => [...trades].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)),
    [trades],
  );

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-4">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Trades
        </span>
        <TradeSheet onSubmit={onAdd} baseCurrency={baseCurrency} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {ordered.length === 0 ? (
          <div className="px-4 py-2 text-muted-foreground text-xs">—</div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {ordered.map((trade) => (
                <tr
                  key={trade.id}
                  className="group border-b last:border-b-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-1 text-muted-foreground tabular-nums">
                    {trade.executedAt.slice(0, 10)}
                  </td>
                  <td className="py-1">
                    <SourceBadge source={trade.source} side={trade.side} />
                  </td>
                  <td className="px-2 py-1 font-medium">{trade.ticker}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {trimQuantity(trade.quantity)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {trade.price.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {money(trade.quantity * trade.price)}
                  </td>
                  <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                    {trade.fees > 0 ? trade.fees.toFixed(2) : ""}
                  </td>
                  <td className="w-8 px-2 py-1 text-right">
                    {/* Generated rows are rebuilt from cached actions, so only
                        manual ones can be removed. */}
                    {trade.source === "manual" ? (
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

type TradeKind = "buy" | "sell" | "deposit" | "withdrawal";

function TradeSheet({
  onSubmit,
  baseCurrency,
}: {
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
  baseCurrency: string;
}) {
  const { client } = useAdmin();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TradeKind>("buy");
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [executedAt, setExecutedAt] = useState(localNow);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const cash = kind === "deposit" || kind === "withdrawal";

  // Defaults the fill to the last known price; the field stays editable so a
  // historical trade can be entered at the price it actually filled at.
  const pickTicker = useCallback(
    (next: string) => {
      const upper = next.toUpperCase();
      setTicker(upper);
      client
        .get<{ quotes: Quote[] }>(
          `/markets/quotes?tickers=${encodeURIComponent(upper)}`,
        )
        .then((data) => {
          const last = data.quotes[0]?.last;
          if (last != null) setPrice(last.toFixed(2));
        })
        .catch(() => undefined);
    },
    [client],
  );

  const reset = useCallback(() => {
    setTicker("");
    setQuantity("");
    setPrice("");
    setFees("");
    setNote("");
    setExecutedAt(localNow());
    setProblem(null);
  }, []);

  const submit = useCallback(async () => {
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      setProblem("Quantity must be positive");
      return;
    }
    const fill = cash ? 1 : Number(price);
    if (!Number.isFinite(fill) || fill < 0) {
      setProblem("Price must be a number");
      return;
    }
    if (!cash && !ticker) {
      setProblem("Pick a symbol");
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({
        ticker: cash ? CASH_TICKER : ticker,
        // A cash movement carries its direction in `source`; `side` still has
        // to satisfy the schema, so it mirrors the movement.
        side: kind === "sell" || kind === "withdrawal" ? "sell" : "buy",
        quantity: amount,
        price: fill,
        fees: Number(fees) || 0,
        executedAt: new Date(executedAt).toISOString(),
        source: cash ? kind : "manual",
        ...(note ? { note } : {}),
      });
      reset();
      setOpen(false);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [
    cash,
    kind,
    ticker,
    quantity,
    price,
    fees,
    executedAt,
    note,
    onSubmit,
    reset,
  ]);

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

        <div className="space-y-3 px-4 text-xs">
          <Tabs
            value={kind}
            onValueChange={(value) => setKind(value as TradeKind)}
          >
            <TabsList variant="line" className="h-7">
              <TabsTrigger value="buy" className="px-2 text-xs">
                Buy
              </TabsTrigger>
              <TabsTrigger value="sell" className="px-2 text-xs">
                Sell
              </TabsTrigger>
              <TabsTrigger value="deposit" className="px-2 text-xs">
                Deposit
              </TabsTrigger>
              <TabsTrigger value="withdrawal" className="px-2 text-xs">
                Withdraw
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {cash ? null : (
            <div className="space-y-1">
              <Label className="text-xs">Symbol</Label>
              <SymbolSearch onSelect={pickTicker} className="w-full" />
              {ticker ? (
                <div className="font-medium tabular-nums">{ticker}</div>
              ) : null}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">
                {cash ? `Amount (${baseCurrency})` : "Quantity"}
              </Label>
              <Input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="decimal"
                className="h-8 text-xs tabular-nums"
              />
            </div>
            {cash ? null : (
              <div className="space-y-1">
                <Label className="text-xs">Price</Label>
                <Input
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  inputMode="decimal"
                  className="h-8 text-xs tabular-nums"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {cash ? null : (
              <div className="space-y-1">
                <Label className="text-xs">Fees</Label>
                <Input
                  value={fees}
                  onChange={(event) => setFees(event.target.value)}
                  inputMode="decimal"
                  className="h-8 text-xs tabular-nums"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Executed</Label>
              <Input
                type="datetime-local"
                value={executedAt}
                onChange={(event) => setExecutedAt(event.target.value)}
                className="h-8 text-xs tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Note</Label>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {problem ? <div className="text-red-600">{problem}</div> : null}
        </div>

        <SheetFooter>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => void submit()}
          >
            Add
          </Button>
        </SheetFooter>
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
      });
      setName("");
      setOpen(false);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [name, initialCash, benchmark, inceptionDate, reinvest, onCreate]);

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
          <Label htmlFor="portfolio-drip" className="text-xs">
            <Switch
              id="portfolio-drip"
              checked={reinvest}
              onCheckedChange={setReinvest}
            />
            DRIP
          </Label>
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

function localNow(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "";
  return value > 0 ? "text-emerald-600" : "text-red-600";
}

function money(value: number): string {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function signedMoney(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${money(value)}`;
}

/** For metrics the core already scaled to percentage points. */
function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

/** For metrics the core returns as a fraction — CAGR, volatility, alpha. */
function fracPct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function num(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** Fractional shares exist, whole ones are the norm — don't pad `10` to `10.0000`. */
function trimQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
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
