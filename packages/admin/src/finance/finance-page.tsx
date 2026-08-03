"use client";

import type {
  FinanceAccount,
  FinanceDashboardResponse,
  FinanceInstitution,
  FinanceLedgerEntry,
  FinanceRecurringCandidate,
  FinanceRecurringRule,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CountrySelect } from "@repo/ui/country-select";
import { CurrencySelect } from "@repo/ui/currency-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { PageHeader } from "@repo/ui/page-header";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { describeRecurrence } from "@repo/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChartCandlestick,
  Check,
  CircleDollarSign,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Unlink,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  BalanceChart,
  CashflowChart,
  Meter,
  Sparkline,
  WaterfallChart,
} from "./finance-charts";
import {
  beginFinanceLink,
  deleteFinanceRule,
  disconnectFinanceAccount,
  fetchFinanceDashboard,
  fetchFinanceInstitutions,
  importFinanceCsv,
  resolveFinanceMatch,
  syncFinanceAccount,
  updateFinanceAccount,
  updateFinanceRule,
} from "./finance-data";
import { EntryDetailSheet, EntrySheet } from "./finance-entry-sheet";
import { FinanceLedgerTable } from "./finance-ledger-table";
import {
  CONNECTION_TONE,
  Empty,
  FieldRow,
  Figure,
  relative,
  SectionHead,
} from "./finance-primitives";
import { RuleSheet } from "./finance-rule-sheet";
import {
  balanceSeries,
  categoryTotals,
  dailyFlow,
  forecastWaterfall,
  type GroupTotal,
  merchantTotals,
  money,
  monthlyCommitment,
  monthToDateSpend,
  nextDueByRule,
  RANGE_DAYS,
  type RangeKey,
  realizedLedger,
  shortDay,
  todayKey,
  visibleLedger,
} from "./finance-series";

function RangeToggle({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {(Object.keys(RANGE_DAYS) as RangeKey[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "border-b pb-0.5 text-[11px] tabular-nums transition-colors",
            value === key
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

export function FinanceSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<CircleDollarSign className="size-4 text-muted-foreground" />}
        title="Finance"
      />
      <div className="space-y-8 overflow-y-auto px-4 py-5">
        <div className="flex flex-wrap gap-x-12 gap-y-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-52 w-full" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}

export function FinancePage({
  manageAccounts = false,
}: {
  manageAccounts?: boolean;
}) {
  const { client, slots, platform, routes } = useAdmin();
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30d");
  const [entryOpen, setEntryOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleSeed, setRuleSeed] = useState<FinanceRecurringCandidate | null>(
    null,
  );
  const [editingRule, setEditingRule] = useState<FinanceRecurringRule | null>(
    null,
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<FinanceAccount | null>(
    null,
  );
  // Held by id, not by value: linking or editing reloads the dashboard, and a
  // captured entry object would keep rendering its pre-save state.
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchFinanceDashboard(client));
      setLoadError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Finance unavailable";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("link");
    if (status === "connected") toast.success("Account connected");
    if (status === "failed" || status === "invalid") toast.error("Link failed");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "n") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      event.preventDefault();
      setEntryOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!data) {
    if (loading) return <FinanceSkeleton />;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader
          icon={<CircleDollarSign className="size-4 text-muted-foreground" />}
          title="Finance"
          leading={slots?.sidebarTrigger}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {loadError ?? "Finance unavailable"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const selectedEntry =
    data.ledger.find((row) => row.id === selectedEntryId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={<CircleDollarSign className="size-4 text-muted-foreground" />}
        title="Finance"
        leading={slots?.sidebarTrigger}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void load()}
          aria-label="Reload"
        >
          <RefreshCw className="size-3.5" />
        </Button>
        {/* Anchors, not platform.navigate: that takes a dashboard-relative
            path and prefixes each app's own base, while routes.* are already
            absolute — passing one to the other double-prefixes it. */}
        <Button variant="ghost" size="sm" asChild>
          <a href={routes.markets} aria-label="Markets">
            <ChartCandlestick className="size-3.5" />
            <span className="hidden sm:inline">Markets</span>
          </a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={routes.portfolios} aria-label="Portfolios">
            <Wallet className="size-3.5" />
            <span className="hidden sm:inline">Portfolios</span>
          </a>
        </Button>
        {manageAccounts && (
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 className="size-3.5" />
            <span className="hidden sm:inline">Add account</span>
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => setEntryOpen(true)}
          disabled={!data.accounts.length}
        >
          <Plus className="size-3.5" />
          Entry
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] space-y-9 px-4 py-6 pb-16">
          <Overview data={data} range={range} onRangeChange={setRange} />

          <Accounts
            data={data}
            range={range}
            manageAccounts={manageAccounts}
            onReload={load}
            onManage={setSelectedAccount}
            onAddAccount={() => setLinkOpen(true)}
          />

          <Tabs defaultValue="ledger" className="space-y-5">
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="ledger">Ledger</TabsTrigger>
              <TabsTrigger value="recurring">
                Recurring
                {data.recurringCandidates.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-4 px-1 text-[9px]"
                  >
                    {data.recurringCandidates.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="reviews">
                Review
                {data.matchReviews.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-4 px-1 text-[9px]"
                  >
                    {data.matchReviews.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="forecast">Forecast</TabsTrigger>
            </TabsList>
            <TabsContent value="ledger">
              <LedgerTab
                data={data}
                range={range}
                onSelectEntry={(entry) => setSelectedEntryId(entry.id)}
              />
            </TabsContent>
            <TabsContent value="recurring">
              <RecurringTab
                data={data}
                onNew={() => {
                  setRuleSeed(null);
                  setEditingRule(null);
                  setRuleOpen(true);
                }}
                onEdit={(rule) => {
                  setRuleSeed(null);
                  setEditingRule(rule);
                  setRuleOpen(true);
                }}
                onCandidate={(candidate) => {
                  setEditingRule(null);
                  setRuleSeed(candidate);
                  setRuleOpen(true);
                }}
                onReload={load}
              />
            </TabsContent>
            <TabsContent value="reviews">
              <ReviewTab data={data} onReload={load} />
            </TabsContent>
            <TabsContent value="forecast">
              <ForecastTab data={data} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <EntrySheet
        open={entryOpen}
        onOpenChange={setEntryOpen}
        accounts={data.accounts}
        categories={data.categories}
        onCreated={load}
      />
      <EntryDetailSheet
        entry={selectedEntry}
        accounts={data.accounts}
        categories={data.categories}
        ledger={data.ledger}
        onClose={() => setSelectedEntryId(null)}
        onSaved={load}
      />
      <RuleSheet
        open={ruleOpen}
        onOpenChange={(open) => {
          setRuleOpen(open);
          if (!open) setEditingRule(null);
        }}
        accounts={data.accounts}
        seed={ruleSeed}
        rule={editingRule}
        onSaved={load}
      />
      {manageAccounts && (
        <>
          <LinkDialog
            open={linkOpen}
            onOpenChange={setLinkOpen}
            onNavigate={(url) => void platform.openExternal(url)}
            onImported={load}
          />
          <AccountSheet
            account={selectedAccount}
            onClose={() => setSelectedAccount(null)}
            onSaved={async () => {
              setSelectedAccount(null);
              await load();
            }}
          />
        </>
      )}
    </div>
  );
}

function Overview({
  data,
  range,
  onRangeChange,
}: {
  data: FinanceDashboardResponse;
  range: RangeKey;
  onRangeChange: (next: RangeKey) => void;
}) {
  const today = todayKey();
  const currency = data.monthly.currency;
  const aggregate =
    data.aggregateBalances.find((item) => item.currency === currency) ??
    data.aggregateBalances[0];

  const realized = useMemo(() => realizedLedger(data.ledger), [data.ledger]);
  const points = useMemo(
    () =>
      balanceSeries({
        entries: realized,
        currentMinor: aggregate?.amountMinor ?? 0,
        days: RANGE_DAYS[range],
        today,
        forecast: data.forecast,
      }),
    [realized, aggregate, range, today, data.forecast],
  );
  const priorSpend = useMemo(
    () => monthToDateSpend(realized, today, 1),
    [realized, today],
  );

  const delta =
    priorSpend > 0
      ? Math.round(((data.monthly.spendMinor - priorSpend) / priorSpend) * 100)
      : null;
  const netMinor = data.monthly.incomeMinor - data.monthly.spendMinor;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-x-12 gap-y-6">
        <Figure
          label="Net balance"
          value={
            aggregate ? money(aggregate.amountMinor, aggregate.currency) : "—"
          }
          meta={`${data.accounts.length} account${data.accounts.length === 1 ? "" : "s"}`}
        />
        <Figure
          label="Month spend"
          value={money(data.monthly.spendMinor, currency)}
          meta={
            delta === null ? (
              "no prior month"
            ) : (
              <span
                className={
                  delta > 0 ? "text-status-critical" : "text-status-good"
                }
              >
                {delta > 0 ? "+" : ""}
                {delta}% vs last month
              </span>
            )
          }
        />
        <Figure
          label="Month income"
          value={money(data.monthly.incomeMinor, currency)}
          meta={`${netMinor >= 0 ? "+" : ""}${money(netMinor, currency)} net`}
        />
        <Figure
          label="Projected EOM"
          value={
            data.forecast
              ? money(data.forecast.p50Minor, data.forecast.currency)
              : "—"
          }
          meta={
            data.forecast
              ? `${money(data.forecast.p25Minor, data.forecast.currency)} – ${money(data.forecast.p75Minor, data.forecast.currency)}`
              : undefined
          }
          tone={
            data.forecast && data.forecast.p50Minor < 0 ? "critical" : undefined
          }
        />
      </div>

      <div className="space-y-3">
        <SectionHead label="Balance">
          <RangeToggle value={range} onChange={onRangeChange} />
        </SectionHead>
        <BalanceChart points={points} currency={currency} />
      </div>
    </section>
  );
}

function Accounts({
  data,
  range,
  manageAccounts,
  onReload,
  onManage,
  onAddAccount,
}: {
  data: FinanceDashboardResponse;
  range: RangeKey;
  manageAccounts: boolean;
  onReload: () => Promise<void>;
  onManage: (account: FinanceAccount) => void;
  onAddAccount: () => void;
}) {
  const { client } = useAdmin();
  const [syncing, setSyncing] = useState<string | null>(null);
  const today = todayKey();

  const balances = useMemo(
    () => new Map(data.balances.map((item) => [item.accountId, item])),
    [data.balances],
  );
  const sparklines = useMemo(() => {
    const realized = realizedLedger(data.ledger);
    const series = new Map<string, number[]>();
    for (const account of data.accounts) {
      const points = balanceSeries({
        entries: realized.filter((row) => row.accountId === account.id),
        currentMinor: balances.get(account.id)?.amountMinor ?? 0,
        days: RANGE_DAYS[range],
        today,
      });
      series.set(
        account.id,
        points.flatMap((point) =>
          point.balanceMinor === undefined ? [] : [point.balanceMinor],
        ),
      );
    }
    return series;
  }, [data.ledger, data.accounts, balances, range, today]);

  async function sync(accountId: string) {
    setSyncing(accountId);
    try {
      const result = await syncFinanceAccount(client, accountId);
      if (result.status === "synced") toast.success("Account synced");
      else if (result.status === "budget_exhausted")
        toast.warning("Fetch budget exhausted");
      else toast.error("Reconnect required");
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <section className="space-y-1">
      <SectionHead label="Accounts">
        {manageAccounts && (
          <Button size="xs" variant="ghost" onClick={onAddAccount}>
            <Plus className="size-3" />
            Account
          </Button>
        )}
      </SectionHead>
      {data.accounts.length === 0 ? (
        manageAccounts ? (
          <div className="py-10 text-center">
            <Button variant="outline" size="sm" onClick={onAddAccount}>
              <Link2 className="size-3.5" />
              Add account
            </Button>
          </div>
        ) : (
          <Empty label="No accounts" />
        )
      ) : (
        <div className="divide-y">
          {data.accounts.map((account) => {
            const balance = balances.get(account.id);
            const used = account.budget.fetchesUsed;
            const limit = account.budget.dailyFetchLimit;
            const reconnect =
              account.connection.status === "reconnect_required";
            return (
              <div key={account.id} className="flex items-center gap-4 py-2.5">
                <StatusDot
                  tone={CONNECTION_TONE[account.connection.status]}
                  label={account.connection.status.replaceAll("_", " ")}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {account.displayName}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">{account.institutionName}</span>
                    <span>·</span>
                    <span className="shrink-0 tabular-nums">
                      {used}/{limit}
                    </span>
                    <Meter
                      share={limit === 0 ? 0 : used / limit}
                      className="w-8 shrink-0"
                    />
                  </div>
                </div>
                <span className="hidden text-[11px] text-muted-foreground sm:block">
                  {reconnect
                    ? account.connection.accessValidUntil
                      ? `expired ${relative(account.connection.accessValidUntil)}`
                      : "reconnect required"
                    : account.budget.nextSyncAt
                      ? `next ${relative(account.budget.nextSyncAt)}`
                      : `synced ${relative(account.lastSyncedAt)}`}
                </span>
                <Sparkline
                  values={sparklines.get(account.id) ?? []}
                  className="hidden h-6 w-24 md:block"
                />
                <div className="w-28 shrink-0 text-right">
                  <div className="text-sm font-medium tabular-nums">
                    {balance
                      ? money(balance.amountMinor, balance.currency)
                      : "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {balance?.balanceType ?? account.currency}
                  </div>
                </div>
                <div className="flex w-14 shrink-0 justify-end gap-0.5">
                  {reconnect && manageAccounts ? (
                    <Button size="xs" variant="outline" onClick={onAddAccount}>
                      Relink
                    </Button>
                  ) : (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Sync account"
                      disabled={syncing === account.id || used >= limit}
                      onClick={() => void sync(account.id)}
                    >
                      {syncing === account.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                    </Button>
                  )}
                  {manageAccounts && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Account settings"
                      onClick={() => onManage(account)}
                    >
                      <Settings2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BreakdownList({
  label,
  items,
  currency,
}: {
  label: string;
  items: GroupTotal[];
  currency: string;
}) {
  return (
    <div className="min-w-0 space-y-2.5">
      <SectionHead label={label} />
      {items.length === 0 ? (
        <Empty label="—" compact />
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <div key={item.key} className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-xs">
                  {item.label}
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  {money(item.spendMinor, currency)}
                </span>
                <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(item.share * 100)}%
                </span>
              </div>
              <Meter share={item.share} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerTab({
  data,
  range,
  onSelectEntry,
}: {
  data: FinanceDashboardResponse;
  range: RangeKey;
  onSelectEntry: (entry: FinanceLedgerEntry) => void;
}) {
  const today = todayKey();
  const days = RANGE_DAYS[range];
  const currency = data.monthly.currency;

  const realized = useMemo(() => realizedLedger(data.ledger), [data.ledger]);
  const rows = useMemo(() => visibleLedger(data.ledger), [data.ledger]);
  const flow = useMemo(
    () => dailyFlow(realized, days, today),
    [realized, days, today],
  );
  const categories = useMemo(
    () => categoryTotals(realized, days, today).slice(0, 8),
    [realized, days, today],
  );
  const merchants = useMemo(
    () => merchantTotals(realized, days, today).slice(0, 6),
    [realized, days, today],
  );

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-5">
        <div className="min-w-0 space-y-3">
          <SectionHead label="Daily flow" />
          <CashflowChart days={flow} currency={currency} />
        </div>
        <FinanceLedgerTable
          entries={rows}
          accounts={data.accounts}
          categories={data.categories}
          onSelect={onSelectEntry}
        />
      </div>
      <aside className="min-w-0 space-y-7">
        <BreakdownList
          label={`Categories · ${range}`}
          items={categories}
          currency={currency}
        />
        <BreakdownList
          label={`Merchants · ${range}`}
          items={merchants}
          currency={currency}
        />
      </aside>
    </div>
  );
}

function RecurringTab({
  data,
  onNew,
  onEdit,
  onCandidate,
  onReload,
}: {
  data: FinanceDashboardResponse;
  onNew: () => void;
  onEdit: (rule: FinanceRecurringRule) => void;
  onCandidate: (candidate: FinanceRecurringCandidate) => void;
  onReload: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
  const today = todayKey();
  const currency = data.monthly.currency;
  const commitment = useMemo(
    () => monthlyCommitment(data.recurringRules),
    [data.recurringRules],
  );
  const nextDue = useMemo(
    () => nextDueByRule(data.ledger, today),
    [data.ledger, today],
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-x-12 gap-y-4">
          <Figure
            label="Monthly out"
            value={money(commitment.expenseMinor, currency)}
            meta={`${data.recurringRules.filter((rule) => rule.status === "active").length} active`}
          />
          <Figure
            label="Monthly in"
            value={money(commitment.incomeMinor, currency)}
          />
          <Figure
            label="Net"
            value={money(
              commitment.incomeMinor - commitment.expenseMinor,
              currency,
            )}
            tone={
              commitment.incomeMinor - commitment.expenseMinor < 0
                ? "critical"
                : "good"
            }
          />
        </div>
        <SectionHead label="Rules">
          <Button size="xs" variant="ghost" onClick={onNew}>
            <Plus className="size-3" />
            Rule
          </Button>
        </SectionHead>
        {data.recurringRules.length === 0 ? (
          <Empty label="No rules" />
        ) : (
          <div className="divide-y">
            {data.recurringRules.map((rule) => {
              const due = nextDue.get(rule.id);
              return (
                <div
                  key={rule.id}
                  className="group flex items-center gap-3 py-2.5"
                >
                  {rule.direction === "income" ? (
                    <ArrowDownLeft className="size-3.5 shrink-0 text-status-good" />
                  ) : (
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70"
                    onClick={() => onEdit(rule)}
                  >
                    <div
                      className={cn(
                        "truncate text-sm",
                        rule.status === "paused" && "text-muted-foreground",
                      )}
                    >
                      {rule.name}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {describeRecurrence(rule.recurrence)}
                      {due ? ` · due ${shortDay(due)}` : ""}
                    </div>
                  </button>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-medium tabular-nums",
                      rule.direction === "income" && "text-status-good",
                    )}
                  >
                    {money(rule.amountMinor, rule.currency)}
                  </span>
                  <Switch
                    className="shrink-0"
                    aria-label={`${rule.name} active`}
                    checked={rule.status === "active"}
                    disabled={pendingRuleId === rule.id}
                    onCheckedChange={async (checked) => {
                      if (pendingRuleId) return;
                      setPendingRuleId(rule.id);
                      try {
                        await updateFinanceRule(client, rule.id, {
                          status: checked ? "active" : "paused",
                        });
                        await onReload();
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Update failed",
                        );
                      } finally {
                        setPendingRuleId(null);
                      }
                    }}
                  />
                  <ConfirmButton
                    title={`Delete ${rule.name}?`}
                    actionLabel="Delete"
                    onConfirm={async () => {
                      try {
                        await deleteFinanceRule(client, rule.id);
                        await onReload();
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Delete failed",
                        );
                      }
                    }}
                    trigger={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Delete ${rule.name}`}
                        className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <aside className="min-w-0 space-y-2">
        <SectionHead label="Detected" />
        {data.recurringCandidates.length === 0 ? (
          <Empty label="—" compact />
        ) : (
          <div className="divide-y">
            {data.recurringCandidates.map((candidate) => (
              <button
                type="button"
                key={`${candidate.accountId}-${candidate.merchantFingerprint}`}
                className="flex w-full min-w-0 items-center gap-3 py-2.5 text-left transition-colors hover:text-foreground"
                onClick={() => onCandidate(candidate)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {candidate.name}
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    every {candidate.intervalDays}d ·{" "}
                    {Math.round(candidate.confidence * 100)}%
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums">
                  {money(candidate.amountMinor, candidate.currency)}
                </span>
                <Plus className="size-3 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function ReviewTab({
  data,
  onReload,
}: {
  data: FinanceDashboardResponse;
  onReload: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);
  const ledger = useMemo(
    () => new Map(data.ledger.map((row) => [row.id, row])),
    [data.ledger],
  );

  if (data.matchReviews.length === 0) return <Empty label="Queue clear" />;

  async function resolve(reviewId: string, action: "accept" | "reject") {
    setBusy(reviewId);
    try {
      await resolveFinanceMatch(client, reviewId, action);
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="divide-y">
      {data.matchReviews.map((review) => {
        const source = ledger.get(review.sourceLedgerId);
        const bank = ledger.get(review.candidateBankLedgerId);
        const drift =
          source && bank ? Math.abs(source.amountMinor - bank.amountMinor) : 0;
        return (
          <div
            key={review.id}
            className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center"
          >
            <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
              {[
                { row: source, tag: "entry" },
                { row: bank, tag: "bank" },
              ].map(({ row, tag }) => (
                <div key={tag} className="flex min-w-0 items-baseline gap-2">
                  <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {tag}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {row?.descriptor ?? "—"}
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {row ? money(row.amountMinor, row.currency) : "—"}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {Math.round(review.confidence * 100)}%
                {drift > 0
                  ? ` · Δ ${money(drift, source?.currency ?? data.monthly.currency)}`
                  : ""}
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy === review.id}
                onClick={() => void resolve(review.id, "reject")}
              >
                <X className="size-3" />
                Reject
              </Button>
              <Button
                size="xs"
                disabled={busy === review.id}
                onClick={() => void resolve(review.id, "accept")}
              >
                {busy === review.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                Match
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ForecastTab({ data }: { data: FinanceDashboardResponse }) {
  const forecast = data.forecast;
  const steps = useMemo(
    () => (forecast ? forecastWaterfall(forecast) : []),
    [forecast],
  );
  if (!forecast) return <Empty label="Forecast unavailable" />;

  const span = forecast.p75Minor - forecast.p25Minor;
  const midPercent =
    span === 0 ? 50 : ((forecast.p50Minor - forecast.p25Minor) / span) * 100;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        <SectionHead label={`Path to ${forecast.asOfDate.slice(0, 7)} close`}>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {forecast.daysRemaining}d left
          </span>
        </SectionHead>
        <WaterfallChart steps={steps} currency={forecast.currency} />
      </div>
      <aside className="min-w-0 space-y-7">
        <div className="space-y-3">
          <SectionHead label="Range" />
          <div className="relative h-6">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground/40" />
            <div className="absolute left-0 top-1/2 h-2 w-px -translate-y-1/2 bg-foreground/40" />
            <div className="absolute right-0 top-1/2 h-2 w-px -translate-y-1/2 bg-foreground/40" />
            <div
              className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
              style={{ left: `${Math.min(100, Math.max(0, midPercent))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{money(forecast.p25Minor, forecast.currency)}</span>
            <span className="font-medium text-foreground">
              {money(forecast.p50Minor, forecast.currency)}
            </span>
            <span>{money(forecast.p75Minor, forecast.currency)}</span>
          </div>
        </div>
        <div className="space-y-2">
          <SectionHead label="Inputs" />
          {(
            [
              ["Current", forecast.currentBalanceMinor],
              ["Recurring due", -forecast.recurringExpensesDueMinor],
              [
                "Discretionary",
                -(
                  forecast.discretionaryDailyRateMinor * forecast.daysRemaining
                ),
              ],
              ["Income due", forecast.expectedIncomeMinor],
              ["Daily rate", forecast.discretionaryDailyRateMinor],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between text-xs"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium tabular-nums">
                {money(value, forecast.currency)}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function LinkDialog({
  open,
  onOpenChange,
  onNavigate,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (url: string) => void;
  onImported: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [country, setCountry] = useState("PT");
  const [query, setQuery] = useState("");
  const [institutions, setInstitutions] = useState<FinanceInstitution[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const [csvName, setCsvName] = useState("");
  const [csvCurrency, setCsvCurrency] = useState("EUR");
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      setInstitutions(await fetchFinanceInstitutions(client, country));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [client, country]);

  useEffect(() => {
    if (open) void search();
  }, [open, search]);

  const filtered = institutions.filter((institution) =>
    institution.name.toLowerCase().includes(query.toLowerCase()),
  );
  const csvRows = csvText.trim() ? csvText.trim().split("\n").length - 1 : 0;

  async function importCsv() {
    if (!csvName.trim() || !csvText.trim()) return;
    setImporting(true);
    try {
      await importFinanceCsv(client, {
        sourceId: csvName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
        displayName: csvName.trim(),
        currency: csvCurrency.toUpperCase(),
        csv: csvText,
      });
      toast.success("CSV imported");
      setCsvText("");
      setCsvName("");
      onOpenChange(false);
      await onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription className="sr-only">
            Link a bank or import a CSV
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="bank" className="gap-4">
          <TabsList variant="line">
            <TabsTrigger value="bank">Bank</TabsTrigger>
            <TabsTrigger value="csv">CSV</TabsTrigger>
          </TabsList>

          <TabsContent value="bank" className="space-y-3">
            <div className="flex min-w-0 items-center gap-2">
              <CountrySelect
                value={country}
                onValueChange={setCountry}
                className="w-40 shrink-0"
              />
              <Input
                value={query}
                placeholder="Filter"
                className="min-w-0 flex-1"
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Search institutions"
                onClick={() => void search()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </div>
            <div className="max-h-[50vh] divide-y overflow-y-auto">
              {filtered.map((institution) => (
                <button
                  type="button"
                  key={institution.id}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition-opacity hover:opacity-70 disabled:opacity-40"
                  disabled={linking !== null}
                  onClick={async () => {
                    setLinking(institution.id);
                    try {
                      const result = await beginFinanceLink(client, {
                        institutionId: institution.id,
                      });
                      onNavigate(result.linkUrl);
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Link failed",
                      );
                    } finally {
                      setLinking(null);
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {institution.name}
                  </span>
                  {linking === institution.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {institution.country}
                    </span>
                  )}
                </button>
              ))}
              {!loading && filtered.length === 0 && <Empty label="—" compact />}
            </div>
          </TabsContent>

          <TabsContent value="csv" className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <FieldRow label="Name" htmlFor="csv-name" className="min-w-0">
                <Input
                  id="csv-name"
                  value={csvName}
                  onChange={(event) => setCsvName(event.target.value)}
                />
              </FieldRow>
              <FieldRow label="Currency" className="min-w-0">
                <CurrencySelect
                  value={csvCurrency}
                  onValueChange={setCsvCurrency}
                />
              </FieldRow>
            </div>
            <FieldRow label="File" htmlFor="csv-file">
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setCsvText(await file.text());
                  if (!csvName.trim()) {
                    setCsvName(file.name.replace(/\.csv$/i, ""));
                  }
                }}
              />
            </FieldRow>
            <FieldRow label="Rows" htmlFor="csv-text">
              <Textarea
                id="csv-text"
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                rows={6}
                className="font-mono text-[11px]"
              />
            </FieldRow>
            <div className="flex items-center gap-3">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {csvRows} rows
              </span>
              <Button
                className="ml-auto"
                onClick={() => void importCsv()}
                disabled={importing || !csvName.trim() || !csvText.trim()}
              >
                {importing && <Loader2 className="size-4 animate-spin" />}
                Import
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AccountSheet({
  account,
  onClose,
  onSaved,
}: {
  account: FinanceAccount | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [displayName, setDisplayName] = useState("");
  const [dailyLimit, setDailyLimit] = useState(4);
  const [reserve, setReserve] = useState(1);
  const [timezone, setTimezone] = useState("UTC");
  const [countsFailed, setCountsFailed] = useState(true);
  const [attendedExempt, setAttendedExempt] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account) return;
    setDisplayName(account.displayName);
    setDailyLimit(account.budget.dailyFetchLimit);
    setReserve(account.budget.reservedManualFetches);
    setTimezone(account.budget.budgetTimezone);
    setCountsFailed(account.budget.countsFailedAttempts);
    setAttendedExempt(account.budget.attendedCallsExempt);
  }, [account]);

  return (
    <Sheet open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{account?.displayName}</SheetTitle>
          <SheetDescription>{account?.institutionName}</SheetDescription>
        </SheetHeader>
        {account && (
          <div className="space-y-6 px-4 pb-6">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Connection</span>
              <span className="flex items-center gap-2">
                <StatusDot
                  tone={CONNECTION_TONE[account.connection.status]}
                  label={account.connection.status.replaceAll("_", " ")}
                />
                {account.connection.status.replaceAll("_", " ")}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Access valid until</span>
              <span className="tabular-nums">
                {account.connection.accessValidUntil
                  ? relative(account.connection.accessValidUntil)
                  : "—"}
              </span>
            </div>

            <FieldRow label="Name" htmlFor="account-name">
              <Input
                id="account-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FieldRow>

            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Daily limit" htmlFor="account-limit">
                <Input
                  id="account-limit"
                  type="number"
                  min={1}
                  value={dailyLimit}
                  className="tabular-nums"
                  onChange={(event) =>
                    setDailyLimit(Number(event.target.value))
                  }
                />
              </FieldRow>
              <FieldRow label="Manual reserve" htmlFor="account-reserve">
                <Input
                  id="account-reserve"
                  type="number"
                  min={0}
                  value={reserve}
                  className="tabular-nums"
                  aria-invalid={reserve >= dailyLimit}
                  onChange={(event) => setReserve(Number(event.target.value))}
                />
              </FieldRow>
            </div>
            <FieldRow label="Budget timezone" htmlFor="account-tz">
              <Input
                id="account-tz"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </FieldRow>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="account-failed" className="text-xs font-normal">
                  Count failed attempts
                </Label>
                <Switch
                  id="account-failed"
                  checked={countsFailed}
                  onCheckedChange={setCountsFailed}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="account-attended"
                  className="text-xs font-normal"
                >
                  Attended calls exempt
                </Label>
                <Switch
                  id="account-attended"
                  checked={attendedExempt}
                  onCheckedChange={setAttendedExempt}
                />
              </div>
            </div>

            <Button
              className="w-full"
              disabled={saving || reserve >= dailyLimit || !displayName.trim()}
              onClick={async () => {
                setSaving(true);
                try {
                  await updateFinanceAccount(client, account.id, {
                    displayName: displayName.trim(),
                    dailyFetchLimit: dailyLimit,
                    reservedManualFetches: reserve,
                    budgetTimezone: timezone,
                    countsFailedAttempts: countsFailed,
                    attendedCallsExempt: attendedExempt,
                  });
                  toast.success("Account updated");
                  await onSaved();
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Update failed",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>

            <ConfirmButton
              title={`Disconnect ${account.displayName}?`}
              actionLabel="Disconnect"
              onConfirm={async () => {
                try {
                  await disconnectFinanceAccount(client, account.id);
                  toast.success("Account disconnected");
                  await onSaved();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Disconnect failed",
                  );
                }
              }}
              trigger={
                <Button variant="ghost" className="w-full text-destructive">
                  <Unlink className="size-4" />
                  Disconnect
                </Button>
              }
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
