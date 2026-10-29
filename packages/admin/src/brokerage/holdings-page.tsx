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
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Stat, StatGroup } from "@repo/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { History, Landmark, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { relative } from "../finance/finance-primitives";
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
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 font-medium text-accent-strong">{title}</div>
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

const HEAD =
  "h-8 px-2 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";
const CELL = "px-2 py-1.5 text-right tabular-nums";

function Holdings({
  holdings,
  baseCurrency,
}: {
  holdings: BrokerageHolding[];
  baseCurrency: string;
}) {
  if (holdings.length === 0) return <EmptyState label="No positions" compact />;
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(HEAD, "pl-0 text-left")}>Symbol</TableHead>
          <TableHead className={HEAD}>Qty</TableHead>
          <TableHead className={cn(HEAD, "hidden sm:table-cell")}>
            Avg
          </TableHead>
          <TableHead className={HEAD}>Last</TableHead>
          <TableHead className={HEAD}>Day</TableHead>
          <TableHead className={HEAD}>Value</TableHead>
          <TableHead className={HEAD}>P&amp;L</TableHead>
          <TableHead className={cn(HEAD, "pr-0")}>Wt</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holdings.map((holding) => {
          const pnlFraction =
            holding.costBasis !== 0
              ? holding.unrealizedPnl / Math.abs(holding.costBasis)
              : null;
          return (
            <TableRow key={holding.conid} className="hover:bg-surface/70">
              <TableCell className="max-w-56 py-1.5 pr-2 pl-0">
                <div className="font-medium text-accent-strong">
                  {holding.symbol}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {holding.description} · {holding.listingExchange}
                  {holding.currency !== baseCurrency
                    ? ` · ${holding.currency}`
                    : ""}
                </div>
              </TableCell>
              <TableCell className={CELL}>
                {trimQuantity(holding.quantity)}
              </TableCell>
              <TableCell
                className={cn(
                  CELL,
                  "hidden text-muted-foreground sm:table-cell",
                )}
              >
                {holding.costBasisPrice.toFixed(2)}
              </TableCell>
              <TableCell className={CELL}>
                {holding.markPrice.toFixed(2)}
              </TableCell>
              <TableCell className={cn(CELL, toneClass(holding.dayChange))}>
                {percent(holding.dayChange)}
              </TableCell>
              <TableCell className={CELL}>
                {amount(holding.valueBase, baseCurrency)}
              </TableCell>
              <TableCell
                className={cn(CELL, toneClass(holding.unrealizedPnlBase))}
              >
                {amount(holding.unrealizedPnlBase, baseCurrency, true)}
                <span className="ml-1 text-[11px]">{percent(pnlFraction)}</span>
              </TableCell>
              <TableCell className={cn(CELL, "pr-0 text-muted-foreground")}>
                {holding.percentOfNav.toFixed(1)}%
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Cash({ cash }: { cash: BrokerageCashBalance[] }) {
  if (cash.length === 0) return <EmptyState label="No cash" compact />;
  return (
    <List divided>
      {cash.map((row) => (
        <ListRow
          key={row.currency}
          title={row.currency}
          description={
            row.settled !== row.amount
              ? `settled ${amount(row.settled, row.currency)}`
              : undefined
          }
          meta={
            <span className="text-accent-strong">
              {amount(row.amount, row.currency)}
            </span>
          }
        />
      ))}
    </List>
  );
}

function activityLabel(row: BrokerageActivity) {
  if (row.kind === "trade") return row.side === "SELL" ? "Sell" : "Buy";
  if (row.type === "Deposits/Withdrawals") {
    return row.amount >= 0 ? "Deposit" : "Withdrawal";
  }
  return row.type;
}

function activityDetail(row: BrokerageActivity) {
  if (row.kind === "trade") {
    return row.quantity !== undefined && row.price !== undefined
      ? `${trimQuantity(Math.abs(row.quantity))} @ ${row.price.toFixed(2)}`
      : undefined;
  }
  return `${row.symbol ? `${row.symbol} · ` : ""}${row.description}`;
}

function Activity({ activity }: { activity: BrokerageActivity[] }) {
  return (
    <List divided>
      {activity.map((row) => (
        <ListRow
          key={row.id}
          title={
            row.kind === "trade" && row.symbol
              ? `${activityLabel(row)} ${row.symbol}`
              : activityLabel(row)
          }
          description={activityDetail(row)}
          meta={
            <>
              <span>{shortDay(row.date)}</span>
              <span
                className={cn(
                  "w-24 text-right",
                  row.kind === "cash"
                    ? toneClass(row.amount) || "text-accent-strong"
                    : "text-accent-strong",
                )}
              >
                {amount(row.amount, row.currency, true)}
              </span>
            </>
          }
        />
      ))}
    </List>
  );
}

function BodySkeleton() {
  return (
    <>
      <StatGroup>
        {["nav", "day", "pnl", "deposits"].map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </StatGroup>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-52 w-full" />
      </div>
      <div className="flex flex-col gap-1">
        <Skeleton className="mb-2 h-3 w-24" />
        {["a", "b", "c", "d", "e"].map((key) => (
          <Skeleton key={key} className="h-9 w-full" />
        ))}
      </div>
    </>
  );
}

function Body({ overview }: { overview: BrokerageOverview }) {
  const [mode, setMode] = useState<"value" | "return">("value");
  const totals = overview.totals;
  const currency = overview.account?.baseCurrency ?? "EUR";

  return (
    <>
      {overview.sync.lastError && (
        <p className="text-xs text-status-critical">
          {overview.sync.lastError}
        </p>
      )}
      {totals ? (
        <StatGroup>
          <Stat
            label="Value"
            value={amount(totals.nav, currency)}
            hint={`cash ${amount(totals.cash, currency)}`}
          />
          <Stat
            label="Day"
            value={
              totals.dayPnl === null
                ? "—"
                : amount(totals.dayPnl, currency, true)
            }
            hint={percent(totals.dayReturn)}
            tone={tone(totals.dayPnl)}
          />
          <Stat
            label="P&L"
            value={amount(totals.pnl, currency, true)}
            hint={`TWR ${percent(totals.cumulativeReturn)}`}
            tone={tone(totals.pnl)}
          />
          <Stat
            label="Deposited"
            value={amount(totals.netDeposits, currency)}
            hint={`income ${amount(totals.income, currency)} · fees ${amount(
              totals.commissions,
              currency,
            )}`}
          />
        </StatGroup>
      ) : (
        <EmptyState icon={<Landmark />} label="No snapshot" />
      )}

      {overview.series.length > 1 && (
        <Section
          title="Performance"
          actions={
            <FilterTabs
              value={mode}
              onChange={setMode}
              options={[
                { value: "value", label: "Value" },
                { value: "return", label: "Return" },
              ]}
            />
          }
        >
          <SeriesChart
            series={overview.series}
            currency={currency}
            mode={mode}
          />
        </Section>
      )}

      {totals && (
        <Section title="Positions" count={overview.holdings.length}>
          <Holdings holdings={overview.holdings} baseCurrency={currency} />
        </Section>
      )}

      {totals && (
        <Section title="Cash" count={overview.cash.length}>
          <Cash cash={overview.cash} />
        </Section>
      )}

      {overview.activity.length > 0 && (
        <Section title="Activity" count={overview.activity.length}>
          <Activity activity={overview.activity} />
        </Section>
      )}
    </>
  );
}

function HoldingsHeader({
  leading,
  children,
}: {
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <PageHeader leading={leading} icon={<Landmark />} title="Holdings">
      {children}
    </PageHeader>
  );
}

/** The page's loading state, for route shells that render before the admin context is ready. */
export function HoldingsSkeleton({ leading }: { leading?: ReactNode }) {
  return (
    <Page>
      <HoldingsHeader leading={leading}>
        <Skeleton className="h-3 w-28" />
      </HoldingsHeader>
      <PageBody>
        <BodySkeleton />
      </PageBody>
    </Page>
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
    <Page>
      <HoldingsHeader leading={slots?.sidebarTrigger}>
        {overview?.asOf && (
          <span className="mr-1 text-xs tabular-nums text-muted-foreground">
            {shortDay(overview.asOf)}
            {overview.sync.lastSyncedAt
              ? ` · synced ${relative(overview.sync.lastSyncedAt)}`
              : ""}
          </span>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Sync last 365 days"
          title="Sync last 365 days"
          disabled={syncing !== null}
          onClick={() => void sync(true)}
        >
          {syncing === "history" ? <Spinner /> : <History />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Sync"
          title="Sync"
          disabled={syncing !== null}
          onClick={() => void sync(false)}
        >
          <RefreshCw className={cn(syncing === "daily" && "animate-spin")} />
        </Button>
      </HoldingsHeader>
      <PageBody>
        {overview ? <Body overview={overview} /> : <BodySkeleton />}
      </PageBody>
    </Page>
  );
}
