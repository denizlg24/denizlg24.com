"use client";

import type {
  BrokerageActivity,
  BrokerageCashBalance,
  BrokerageHolding,
  BrokerageOverview,
  BrokerageSeriesPoint,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@repo/ui/chart";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { History, Landmark, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  Empty,
  Figure,
  relative,
  SectionHead,
} from "../finance/finance-primitives";
import { shortDay } from "../finance/finance-series";
import { toneClass, trimQuantity } from "../markets/format";
import { useAdmin } from "../provider";
import { fetchBrokerageOverview, syncBrokerage } from "./brokerage-data";

function amount(value: number, currency: string, signed = false) {
  const formatted = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function percent(fraction: number | null, signed = true) {
  if (fraction === null) return "—";
  const value = (fraction * 100).toFixed(2);
  return `${signed && fraction > 0 ? "+" : ""}${value}%`;
}

function tone(
  value: number | null | undefined,
): "good" | "critical" | undefined {
  if (!value) return undefined;
  return value > 0 ? "good" : "critical";
}

const valueConfig = {
  nav: { label: "Value", color: "var(--color-chart-1)" },
  netDeposits: { label: "Deposited", color: "var(--color-muted-foreground)" },
} satisfies ChartConfig;

const returnConfig = {
  returnPct: { label: "Return", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

function TooltipRows({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; className?: string }[];
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-medium">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-4">
          <span className="text-muted-foreground">{row.label}</span>
          <span
            className={cn("ml-auto font-medium tabular-nums", row.className)}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function SeriesChart({
  series,
  currency,
  mode,
}: {
  series: BrokerageSeriesPoint[];
  currency: string;
  mode: "value" | "return";
}) {
  const data = series.map((point) => ({
    ...point,
    returnPct: point.cumulativeReturn * 100,
  }));
  const tooltip = (
    <ChartTooltip
      content={({ active, payload, label }) => {
        const point = payload?.[0]?.payload as BrokerageSeriesPoint | undefined;
        if (!active || !point) return null;
        return (
          <TooltipRows
            title={shortDay(String(label))}
            rows={[
              { label: "Value", value: amount(point.nav, currency) },
              {
                label: "Deposited",
                value: amount(point.netDeposits, currency),
              },
              {
                label: "Return",
                value: percent(point.cumulativeReturn),
                className: toneClass(point.cumulativeReturn),
              },
            ]}
          />
        );
      }}
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="2 4" />
      <XAxis
        dataKey="date"
        tickLine={false}
        axisLine={false}
        tickMargin={10}
        minTickGap={40}
        tickFormatter={shortDay}
      />
    </>
  );

  if (mode === "return") {
    return (
      <ChartContainer config={returnConfig} className="h-52 w-full">
        <LineChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
          {axes}
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={48}
            tickFormatter={(value: number) => `${value.toFixed(1)}%`}
          />
          <ReferenceLine y={0} stroke="var(--color-border)" />
          {tooltip}
          <Line
            dataKey="returnPct"
            type="monotone"
            stroke="var(--color-returnPct)"
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={valueConfig} className="h-52 w-full">
      <LineChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
        {axes}
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          domain={["auto", "auto"]}
          tickFormatter={(value: number) =>
            new Intl.NumberFormat("en-GB", {
              style: "currency",
              currency,
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(value)
          }
        />
        {tooltip}
        <Line
          dataKey="netDeposits"
          type="stepAfter"
          stroke="var(--color-netDeposits)"
          strokeWidth={1.25}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="nav"
          type="monotone"
          stroke="var(--color-nav)"
          strokeWidth={1.75}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

function Holdings({
  holdings,
  baseCurrency,
}: {
  holdings: BrokerageHolding[];
  baseCurrency: string;
}) {
  if (holdings.length === 0) return <Empty label="—" compact />;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr className="border-b">
            <th className="py-1 pr-2 text-left font-normal">Symbol</th>
            <th className="px-1.5 py-1 text-right font-normal">Qty</th>
            <th className="hidden px-1.5 py-1 text-right font-normal sm:table-cell">
              Avg
            </th>
            <th className="px-1.5 py-1 text-right font-normal">Last</th>
            <th className="px-1.5 py-1 text-right font-normal">Day</th>
            <th className="px-1.5 py-1 text-right font-normal">Value</th>
            <th className="px-1.5 py-1 text-right font-normal">P&amp;L</th>
            <th className="py-1 pl-1.5 text-right font-normal">Wt</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const pnlFraction =
              holding.costBasis !== 0
                ? holding.unrealizedPnl / Math.abs(holding.costBasis)
                : null;
            return (
              <tr key={holding.conid} className="border-b last:border-b-0">
                <td className="max-w-56 py-1.5 pr-2">
                  <div className="font-medium">{holding.symbol}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {holding.description} · {holding.listingExchange}
                    {holding.currency !== baseCurrency
                      ? ` · ${holding.currency}`
                      : ""}
                  </div>
                </td>
                <td className="px-1.5 text-right tabular-nums">
                  {trimQuantity(holding.quantity)}
                </td>
                <td className="hidden px-1.5 text-right text-muted-foreground tabular-nums sm:table-cell">
                  {holding.costBasisPrice.toFixed(2)}
                </td>
                <td className="px-1.5 text-right tabular-nums">
                  {holding.markPrice.toFixed(2)}
                </td>
                <td
                  className={cn(
                    "px-1.5 text-right tabular-nums",
                    toneClass(holding.dayChange),
                  )}
                >
                  {percent(holding.dayChange)}
                </td>
                <td className="px-1.5 text-right tabular-nums">
                  {amount(holding.valueBase, baseCurrency)}
                </td>
                <td
                  className={cn(
                    "px-1.5 text-right tabular-nums",
                    toneClass(holding.unrealizedPnlBase),
                  )}
                >
                  {amount(holding.unrealizedPnlBase, baseCurrency, true)}
                  <span className="ml-1 text-[10px]">
                    {percent(pnlFraction)}
                  </span>
                </td>
                <td className="pl-1.5 text-right text-muted-foreground tabular-nums">
                  {holding.percentOfNav.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cash({ cash }: { cash: BrokerageCashBalance[] }) {
  if (cash.length === 0) return <Empty label="—" compact />;
  return (
    <div className="divide-y text-xs">
      {cash.map((row) => (
        <div key={row.currency} className="flex items-center py-1.5">
          <span className="font-medium">{row.currency}</span>
          {row.settled !== row.amount && (
            <span className="ml-3 text-muted-foreground tabular-nums">
              settled {amount(row.settled, row.currency)}
            </span>
          )}
          <span className="ml-auto tabular-nums">
            {amount(row.amount, row.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

function activityLabel(row: BrokerageActivity) {
  if (row.kind === "trade") return row.side === "SELL" ? "Sell" : "Buy";
  if (row.type === "Deposits/Withdrawals") {
    return row.amount >= 0 ? "Deposit" : "Withdrawal";
  }
  return row.type;
}

function Activity({ activity }: { activity: BrokerageActivity[] }) {
  if (activity.length === 0) return <Empty label="—" compact />;
  return (
    <div className="divide-y text-xs">
      {activity.map((row) => (
        <div key={row.id} className="flex items-center gap-3 py-1.5">
          <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
            {shortDay(row.date)}
          </span>
          <span className="w-20 shrink-0 truncate">{activityLabel(row)}</span>
          <span className="min-w-0 flex-1 truncate">
            {row.kind === "trade" ? (
              <>
                <span className="font-medium">{row.symbol}</span>
                {row.quantity !== undefined && row.price !== undefined && (
                  <span className="ml-2 text-muted-foreground tabular-nums">
                    {trimQuantity(Math.abs(row.quantity))} @{" "}
                    {row.price.toFixed(2)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">
                {row.symbol ? `${row.symbol} · ` : ""}
                {row.description}
              </span>
            )}
          </span>
          <span
            className={cn(
              "shrink-0 tabular-nums",
              row.kind === "cash" && toneClass(row.amount),
            )}
          >
            {amount(row.amount, row.currency, true)}
          </span>
        </div>
      ))}
    </div>
  );
}

function HoldingsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {["nav", "day", "pnl", "deposits"].map((key) => (
          <div key={key} className="space-y-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-52 w-full" />
      <div className="space-y-2">
        {["a", "b", "c", "d", "e"].map((key) => (
          <Skeleton key={key} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

function Body({ overview }: { overview: BrokerageOverview }) {
  const [mode, setMode] = useState<"value" | "return">("value");
  const totals = overview.totals;
  const currency = overview.account?.baseCurrency ?? "EUR";

  return (
    <div className="space-y-8">
      {overview.sync.lastError && (
        <div className="text-status-critical text-xs">
          {overview.sync.lastError}
        </div>
      )}
      {totals ? (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Figure
            label="Value"
            value={amount(totals.nav, currency)}
            meta={`cash ${amount(totals.cash, currency)}`}
          />
          <Figure
            label="Day"
            value={
              totals.dayPnl === null
                ? "—"
                : amount(totals.dayPnl, currency, true)
            }
            meta={percent(totals.dayReturn)}
            tone={tone(totals.dayPnl)}
          />
          <Figure
            label="P&L"
            value={amount(totals.pnl, currency, true)}
            meta={`TWR ${percent(totals.cumulativeReturn)}`}
            tone={tone(totals.pnl)}
          />
          <Figure
            label="Deposited"
            value={amount(totals.netDeposits, currency)}
            meta={`income ${amount(totals.income, currency)} · fees ${amount(
              totals.commissions,
              currency,
            )}`}
          />
        </div>
      ) : (
        <Empty label="—" />
      )}

      {overview.series.length > 1 && (
        <section className="space-y-3">
          <SectionHead label="Performance">
            <div className="flex gap-1 text-[11px]">
              {(["value", "return"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  className={cn(
                    "rounded px-1.5 py-0.5 capitalize",
                    mode === option
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </SectionHead>
          <SeriesChart
            series={overview.series}
            currency={currency}
            mode={mode}
          />
        </section>
      )}

      {totals && (
        <section className="space-y-2">
          <SectionHead label={`Positions · ${overview.holdings.length}`} />
          <Holdings holdings={overview.holdings} baseCurrency={currency} />
        </section>
      )}

      {totals && (
        <section className="space-y-2">
          <SectionHead label="Cash" />
          <Cash cash={overview.cash} />
        </section>
      )}

      {overview.activity.length > 0 && (
        <section className="space-y-2">
          <SectionHead label="Activity" />
          <Activity activity={overview.activity} />
        </section>
      )}
    </div>
  );
}

export function HoldingsPage() {
  const { client, slots } = useAdmin();
  const [overview, setOverview] = useState<BrokerageOverview | null>(null);
  const [syncing, setSyncing] = useState<"daily" | "history" | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await fetchBrokerageOverview(client));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Holdings unavailable",
      );
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async (history: boolean) => {
    setSyncing(history ? "history" : "daily");
    try {
      const result = await syncBrokerage(client, { history });
      toast.success(
        `${result.snapshots} ${result.snapshots === 1 ? "day" : "days"}, ${result.activity} activity`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncing(null);
      await load();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Landmark className="size-4 text-muted-foreground" />}
        title="Holdings"
      >
        {overview?.asOf && (
          <span
            className="text-muted-foreground text-xs tabular-nums"
            title={
              overview.sync.lastSyncedAt
                ? `synced ${relative(overview.sync.lastSyncedAt)}`
                : undefined
            }
          >
            {shortDay(overview.asOf)}
          </span>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label="Sync last 365 days"
          title="Sync last 365 days"
          disabled={syncing !== null}
          onClick={() => void sync(true)}
        >
          {syncing === "history" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <History className="size-4" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Sync"
          title="Sync"
          disabled={syncing !== null}
          onClick={() => void sync(false)}
        >
          <RefreshCw
            className={cn("size-4", syncing === "daily" && "animate-spin")}
          />
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-5">
          {overview ? <Body overview={overview} /> : <HoldingsSkeleton />}
        </div>
      </div>
    </div>
  );
}
