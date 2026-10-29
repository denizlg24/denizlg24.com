"use client";

import type {
  FinanceAccount,
  FinanceDashboardResponse,
  FinanceInstitution,
  FinanceLedgerEntry,
  FinanceRecurringCandidate,
  FinanceRecurringRule,
} from "@repo/schemas";
import { pickDisplayBalance } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CountrySelect } from "@repo/ui/country-select";
import { CurrencySelect } from "@repo/ui/currency-select";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Meter } from "@repo/ui/meter";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs, SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { describeRecurrence } from "@repo/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChartCandlestick,
  CircleDollarSign,
  Landmark,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
  Wallet,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  BalanceChart,
  CashflowChart,
  Sparkline,
  WaterfallChart,
} from "./finance-charts";
import {
  beginFinanceLink,
  deleteFinanceRule,
  fetchFinanceDashboard,
  fetchFinanceInstitutions,
  importFinanceCsv,
  syncFinanceAccount,
  updateFinanceRule,
} from "./finance-data";
import { FinanceLedgerTable } from "./finance-ledger-table";
import { CONNECTION_TONE, relative } from "./finance-primitives";
import {
  balanceSeries,
  baseLedger,
  categoryTotals,
  countedLedger,
  dailyFlow,
  forecastWaterfall,
  type GroupTotal,
  merchantTotals,
  money,
  monthToDateSpend,
  nextDueByRule,
  RANGE_DAYS,
  type RangeKey,
  realizedLedger,
  shortDay,
  todayKey,
  visibleLedger,
} from "./finance-series";

const FinanceReviewsPage = dynamic(() =>
  import("./finance-reviews-page").then((module) => module.FinanceReviewsPage),
);
const FinanceBudgetPage = dynamic(() =>
  import("./finance-budget-page").then((module) => module.FinanceBudgetPage),
);
const FinancePayrollTab = dynamic(() =>
  import("./finance-payroll").then((module) => module.FinancePayrollTab),
);
const FinanceAlertsPage = dynamic(() =>
  import("./finance-alerts-page").then((module) => module.FinanceAlertsPage),
);

const FINANCE_TABS = new Set([
  "ledger",
  "recurring",
  "payroll",
  "reviews",
  "budget",
  "alerts",
  "forecast",
]);

const RANGE_OPTIONS = (Object.keys(RANGE_DAYS) as RangeKey[]).map((key) => ({
  value: key,
  label: key,
}));

/**
 * Keeps clicks inside row controls — including those from portalled
 * confirmation dialogs, which bubble through the React tree — from also
 * activating the row.
 */
export function StopRowClick({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

function FinanceHeader({ children }: { children?: ReactNode }) {
  const { slots } = useAdmin();
  return (
    <PageHeader
      leading={slots?.sidebarTrigger}
      icon={<CircleDollarSign />}
      title="Finance"
    >
      {children}
    </PageHeader>
  );
}

export function FinanceSkeleton() {
  return (
    <Page>
      <FinanceHeader />
      <PageBody width="wide">
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-52 w-full" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </PageBody>
    </Page>
  );
}

export function FinancePage({
  manageAccounts = false,
}: {
  manageAccounts?: boolean;
}) {
  const { client, platform, routes } = useAdmin();
  const router = useRouter();
  const [tab, setTab] = useState("ledger");
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30d");
  const [linkOpen, setLinkOpen] = useState(false);
  const hasAccounts = Boolean(data?.accounts.length);

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
    const search = new URLSearchParams(window.location.search);
    const requestedTab = search.get("tab");
    if (requestedTab && FINANCE_TABS.has(requestedTab)) setTab(requestedTab);
    const status = search.get("link");
    if (status === "connected") toast.success("Account connected");
    if (status === "no-accounts") {
      toast.error(
        "No account was returned. Link it in the Enable Banking control panel first.",
      );
    }
    if (status === "failed" || status === "invalid") toast.error("Link failed");
    if (status) {
      const url = new URL(window.location.href);
      url.searchParams.delete("link");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  const selectTab = useCallback((next: string) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "ledger") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "n") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!hasAccounts) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      event.preventDefault();
      router.push(routes.finance.entryNew);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, routes, hasAccounts]);

  if (!data) {
    if (loading) return <FinanceSkeleton />;
    return (
      <Page>
        <FinanceHeader />
        <EmptyState
          icon={<CircleDollarSign />}
          label={loadError ?? "Finance unavailable"}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              <RefreshCw />
              Retry
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <FinanceHeader>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void load()}
          aria-label="Reload"
        >
          <RefreshCw />
        </Button>
        {/* Anchors, not platform.navigate: that takes a dashboard-relative
            path and prefixes each app's own base, while routes.* are already
            absolute — passing one to the other double-prefixes it. */}
        <Button variant="ghost" size="sm" asChild>
          <a href={routes.markets} aria-label="Markets">
            <ChartCandlestick />
            <span className="hidden sm:inline">Markets</span>
          </a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={routes.portfolios} aria-label="Portfolios">
            <Wallet />
            <span className="hidden sm:inline">Portfolios</span>
          </a>
        </Button>
        {manageAccounts && (
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 />
            <span className="hidden sm:inline">Add account</span>
          </Button>
        )}
        {hasAccounts ? (
          <Button size="sm" asChild>
            <Link href={routes.finance.entryNew}>
              <Plus />
              Entry
            </Link>
          </Button>
        ) : (
          <Button size="sm" disabled>
            <Plus />
            Entry
          </Button>
        )}
      </FinanceHeader>

      <PageBody width="wide">
        <Overview data={data} range={range} onRangeChange={setRange} />

        <Accounts
          data={data}
          range={range}
          manageAccounts={manageAccounts}
          onReload={load}
          onManage={(account) =>
            router.push(routes.finance.account(account.id))
          }
          onAddAccount={() => setLinkOpen(true)}
        />

        <Tabs value={tab} onValueChange={selectTab} className="gap-5">
          <TabsList
            variant="line"
            className="w-full justify-start overflow-x-auto"
          >
            <TabsTrigger value="ledger" className="flex-none">
              Ledger
            </TabsTrigger>
            <TabsTrigger value="recurring" className="flex-none">
              Recurring
              {data.recurringCandidates.length > 0 && (
                <Badge variant="secondary">
                  {data.recurringCandidates.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="payroll" className="flex-none">
              Payroll
            </TabsTrigger>
            <TabsTrigger value="reviews" className="flex-none">
              Review
              {data.matchReviews.length > 0 && (
                <Badge variant="info">{data.matchReviews.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="budget" className="flex-none">
              Budget
            </TabsTrigger>
            <TabsTrigger value="alerts" className="flex-none">
              <Bell />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="forecast" className="flex-none">
              Forecast
            </TabsTrigger>
          </TabsList>
          <TabsContent value="ledger">
            <LedgerTab
              data={data}
              range={range}
              onSelectEntry={(entry) =>
                router.push(routes.finance.entry(entry.id))
              }
            />
          </TabsContent>
          <TabsContent value="recurring">
            <RecurringTab
              data={data}
              onNew={() => router.push(routes.finance.ruleNew)}
              onEdit={(rule) => router.push(routes.finance.rule(rule.id))}
              onCandidate={(candidate) =>
                router.push(
                  `${routes.finance.ruleNew}${routes.finance.ruleNew.includes("?") ? "&" : "?"}candidate=${encodeURIComponent(candidate.merchantFingerprint)}`,
                )
              }
              onReload={load}
            />
          </TabsContent>
          <TabsContent value="payroll">
            <FinancePayrollTab data={data} onReload={load} />
          </TabsContent>
          <TabsContent value="reviews">
            <FinanceReviewsPage embedded dashboard={data} onReload={load} />
          </TabsContent>
          <TabsContent value="budget">
            <FinanceBudgetPage
              embedded
              onOpenAlerts={() => selectTab("alerts")}
            />
          </TabsContent>
          <TabsContent value="alerts">
            <FinanceAlertsPage embedded />
          </TabsContent>
          <TabsContent value="forecast">
            <ForecastTab data={data} />
          </TabsContent>
        </Tabs>
      </PageBody>

      {manageAccounts && (
        <LinkDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          onNavigate={(url) => void platform.openExternal(url)}
          onImported={load}
        />
      )}
    </Page>
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
  const { routes } = useAdmin();
  const today = todayKey();
  const currency = data.monthly.currency;
  const aggregate =
    data.aggregateBalances.find((item) => item.currency === currency) ??
    data.aggregateBalances[0];
  const netWorth = data.netWorth.find((item) => item.currency === currency);
  const invested = data.investments.reduce(
    (total, row) => total + (row.valueBase?.amountMinor ?? 0),
    0,
  );

  const converted = useMemo(() => baseLedger(data), [data]);
  const counted = useMemo(() => countedLedger(data), [data]);
  const points = useMemo(
    () =>
      balanceSeries({
        entries: converted,
        currentMinor: aggregate?.amountMinor ?? 0,
        days: RANGE_DAYS[range],
        today,
        forecast: data.forecast,
      }),
    [converted, aggregate, range, today, data.forecast],
  );
  const priorSpend = useMemo(
    () => monthToDateSpend(counted, today, 1),
    [counted, today],
  );

  const delta =
    priorSpend > 0
      ? Math.round(((data.monthly.spendMinor - priorSpend) / priorSpend) * 100)
      : null;
  const netMinor = data.monthly.incomeMinor - data.monthly.spendMinor;

  return (
    <>
      <StatGroup>
        {data.investments.length > 0 && netWorth && (
          <Stat
            label="Net worth"
            value={money(netWorth.amountMinor, netWorth.currency)}
            hint={
              <Link href={routes.holdings} className="hover:text-accent-strong">
                {money(invested, currency)} invested
              </Link>
            }
          />
        )}
        <Stat
          label="Net balance"
          value={
            aggregate ? money(aggregate.amountMinor, aggregate.currency) : "—"
          }
          hint={`${data.accounts.length} account${data.accounts.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Month spend"
          value={money(data.monthly.spendMinor, currency)}
          hint={
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
        <Stat
          label="Month income"
          value={money(data.monthly.incomeMinor, currency)}
          hint={`${netMinor >= 0 ? "+" : ""}${money(netMinor, currency)} net`}
        />
        <Stat
          label="Projected EOM"
          value={
            data.forecast
              ? money(data.forecast.p50Minor, data.forecast.currency)
              : "—"
          }
          hint={
            data.forecast
              ? `${money(data.forecast.p25Minor, data.forecast.currency)} – ${money(data.forecast.p75Minor, data.forecast.currency)}`
              : undefined
          }
          tone={
            data.forecast && data.forecast.p50Minor < 0 ? "critical" : "default"
          }
        />
      </StatGroup>

      <Section
        title="Balance"
        actions={
          <FilterTabs
            value={range}
            onChange={onRangeChange}
            options={RANGE_OPTIONS}
          />
        }
      >
        <BalanceChart points={points} currency={currency} />
      </Section>
    </>
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
    () =>
      new Map(
        data.accounts.map((account) => [
          account.id,
          pickDisplayBalance(data.balances, account.id),
        ]),
      ),
    [data.accounts, data.balances],
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
    <Section
      title="Accounts"
      count={data.accounts.length}
      actions={
        manageAccounts ? (
          <Button size="sm" variant="ghost" onClick={onAddAccount}>
            <Plus />
            Account
          </Button>
        ) : undefined
      }
    >
      {data.accounts.length === 0 ? (
        <EmptyState
          compact
          icon={<Landmark />}
          label="No accounts"
          action={
            manageAccounts ? (
              <Button variant="outline" size="sm" onClick={onAddAccount}>
                <Link2 />
                Add account
              </Button>
            ) : undefined
          }
        />
      ) : (
        <List divided>
          {data.accounts.map((account) => {
            const balance = balances.get(account.id);
            const used = account.budget.fetchesUsed;
            const limit = account.budget.dailyFetchLimit;
            const reconnect =
              account.connection.status === "reconnect_required";
            return (
              <ListRow
                key={account.id}
                onClick={manageAccounts ? () => onManage(account) : undefined}
                leading={
                  <StatusDot
                    tone={CONNECTION_TONE[account.connection.status]}
                    label={account.connection.status.replaceAll("_", " ")}
                  />
                }
                title={account.displayName}
                description={
                  <>
                    {account.institutionName} ·{" "}
                    <span className="tabular-nums">
                      {used}/{limit} fetches
                    </span>
                  </>
                }
                meta={
                  <>
                    <span className="hidden sm:inline">
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
                    <span className="flex w-28 flex-col items-end">
                      <span className="text-sm font-medium text-accent-strong">
                        {balance
                          ? money(balance.amountMinor, balance.currency)
                          : "—"}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.08em]">
                        {balance?.balanceType ?? account.currency}
                      </span>
                    </span>
                  </>
                }
                trailing={
                  <StopRowClick>
                    {reconnect && manageAccounts ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onAddAccount}
                      >
                        Relink
                      </Button>
                    ) : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Sync account"
                        disabled={syncing === account.id || used >= limit}
                        onClick={() => void sync(account.id)}
                      >
                        {syncing === account.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <RefreshCw />
                        )}
                      </Button>
                    )}
                  </StopRowClick>
                }
              />
            );
          })}
        </List>
      )}
    </Section>
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
    <Section title={label}>
      {items.length === 0 ? (
        <EmptyState compact label="—" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <div key={item.key} className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-baseline gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 font-medium tabular-nums text-accent-strong">
                  {money(item.spendMinor, currency)}
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                  {Math.round(item.share * 100)}%
                </span>
              </div>
              <Meter value={item.share} />
            </div>
          ))}
        </div>
      )}
    </Section>
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

  const counted = useMemo(() => countedLedger(data), [data]);
  const rows = useMemo(() => visibleLedger(data.ledger), [data.ledger]);
  const flow = useMemo(
    () => dailyFlow(counted, days, today),
    [counted, days, today],
  );
  const categories = useMemo(
    () => categoryTotals(counted, days, today).slice(0, 8),
    [counted, days, today],
  );
  const merchants = useMemo(
    () => merchantTotals(counted, days, today).slice(0, 6),
    [counted, days, today],
  );

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Section title="Daily flow">
          <CashflowChart days={flow} currency={currency} />
        </Section>
        <FinanceLedgerTable
          entries={rows}
          accounts={data.accounts}
          categories={data.categories}
          onSelect={onSelectEntry}
        />
      </div>
      <aside className="flex min-w-0 flex-col gap-7">
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
  // Converted server-side against dated FX snapshots. Summing rule amounts
  // here instead would add a 100 DKK rule to a euro total as if it were €100.
  const commitment = data.recurringCommitment;
  const currency = commitment.currency;
  const net = commitment.incomeMinor - commitment.expenseMinor;
  const nextDue = useMemo(
    () => nextDueByRule(data.ledger, today),
    [data.ledger, today],
  );

  async function setActive(rule: FinanceRecurringRule, checked: boolean) {
    if (pendingRuleId) return;
    setPendingRuleId(rule.id);
    try {
      await updateFinanceRule(client, rule.id, {
        status: checked ? "active" : "paused",
      });
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setPendingRuleId(null);
    }
  }

  async function remove(rule: FinanceRecurringRule) {
    try {
      await deleteFinanceRule(client, rule.id);
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <StatGroup>
            <Stat
              label="Monthly out"
              value={money(commitment.expenseMinor, currency)}
              hint={`${data.recurringRules.filter((rule) => rule.status === "active").length} active`}
            />
            <Stat
              label="Monthly in"
              value={money(commitment.incomeMinor, currency)}
            />
            <Stat
              label="Net"
              value={money(net, currency)}
              tone={net < 0 ? "critical" : "good"}
            />
          </StatGroup>
          {commitment.unconvertedByCurrency.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Excluded, no rate:{" "}
              {commitment.unconvertedByCurrency
                .map(
                  (row) =>
                    `${money(row.amountMinor, row.currency)} ${row.direction}`,
                )
                .join(", ")}
            </p>
          )}
        </div>
        <Section
          title="Rules"
          count={data.recurringRules.length}
          actions={
            <Button size="sm" variant="ghost" onClick={onNew}>
              <Plus />
              Rule
            </Button>
          }
        >
          {data.recurringRules.length === 0 ? (
            <EmptyState compact icon={<Repeat />} label="No rules" />
          ) : (
            <List divided>
              {data.recurringRules.map((rule) => {
                const due = nextDue.get(rule.id);
                return (
                  <ListRow
                    key={rule.id}
                    onClick={() => onEdit(rule)}
                    leading={
                      rule.direction === "income" ? (
                        <ArrowDownLeft className="text-status-good" />
                      ) : (
                        <ArrowUpRight />
                      )
                    }
                    title={
                      <span
                        className={cn(
                          rule.status === "paused" && "text-muted-foreground",
                        )}
                      >
                        {rule.name}
                      </span>
                    }
                    description={`${describeRecurrence(rule.recurrence)}${due ? ` · due ${shortDay(due)}` : ""}`}
                    meta={
                      <span
                        className={cn(
                          "text-sm font-medium",
                          rule.direction === "income"
                            ? "text-status-good"
                            : "text-accent-strong",
                        )}
                      >
                        {money(rule.amountMinor, rule.currency)}
                      </span>
                    }
                    trailing={
                      <StopRowClick>
                        <Switch
                          aria-label={`${rule.name} active`}
                          checked={rule.status === "active"}
                          disabled={pendingRuleId === rule.id}
                          onCheckedChange={(checked) =>
                            void setActive(rule, checked)
                          }
                        />
                        <ConfirmButton
                          title={`Delete ${rule.name}?`}
                          actionLabel="Delete"
                          destructive
                          onConfirm={() => remove(rule)}
                          trigger={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Delete ${rule.name}`}
                              className="text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
                            >
                              <Trash2 />
                            </Button>
                          }
                        />
                      </StopRowClick>
                    }
                  />
                );
              })}
            </List>
          )}
        </Section>
      </div>
      <aside className="min-w-0">
        <Section title="Detected" count={data.recurringCandidates.length}>
          {data.recurringCandidates.length === 0 ? (
            <EmptyState compact label="—" />
          ) : (
            <List divided>
              {data.recurringCandidates.map((candidate) => (
                <ListRow
                  key={`${candidate.accountId}-${candidate.merchantFingerprint}`}
                  onClick={() => onCandidate(candidate)}
                  title={candidate.name}
                  description={`every ${candidate.intervalDays}d · ${Math.round(candidate.confidence * 100)}%`}
                  meta={money(candidate.amountMinor, candidate.currency)}
                  trailing={<Plus className="size-3.5 text-muted-foreground" />}
                />
              ))}
            </List>
          )}
        </Section>
      </aside>
    </div>
  );
}

function ForecastTab({ data }: { data: FinanceDashboardResponse }) {
  const forecast = data.forecast;
  const steps = useMemo(
    () => (forecast ? forecastWaterfall(forecast) : []),
    [forecast],
  );
  if (!forecast) return <EmptyState label="Forecast unavailable" />;

  const span = forecast.p75Minor - forecast.p25Minor;
  const midPercent =
    span === 0 ? 50 : ((forecast.p50Minor - forecast.p25Minor) / span) * 100;

  const inputs: [string, number][] = [
    ["Current", forecast.currentBalanceMinor],
    ["Recurring due", -forecast.recurringExpensesDueMinor],
    [
      "Discretionary",
      -(forecast.discretionaryDailyRateMinor * forecast.daysRemaining),
    ],
    ["Income due", forecast.expectedIncomeMinor],
    ["Daily rate", forecast.discretionaryDailyRateMinor],
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Section
        title={`Path to ${forecast.asOfDate.slice(0, 7)} close`}
        actions={
          <span className="text-xs tabular-nums text-muted-foreground">
            {forecast.daysRemaining}d left
          </span>
        }
        className="min-w-0"
      >
        <WaterfallChart steps={steps} currency={forecast.currency} />
      </Section>
      <aside className="flex min-w-0 flex-col gap-7">
        <Section title="Range">
          <div className="relative h-6">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
            <div className="absolute left-0 top-1/2 h-2 w-px -translate-y-1/2 bg-muted-foreground" />
            <div className="absolute right-0 top-1/2 h-2 w-px -translate-y-1/2 bg-muted-foreground" />
            <div
              className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-strong"
              style={{ left: `${Math.min(100, Math.max(0, midPercent))}%` }}
            />
          </div>
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{money(forecast.p25Minor, forecast.currency)}</span>
            <span className="font-medium text-accent-strong">
              {money(forecast.p50Minor, forecast.currency)}
            </span>
            <span>{money(forecast.p75Minor, forecast.currency)}</span>
          </div>
        </Section>
        <Section title="Inputs">
          <Properties>
            {inputs.map(([label, value]) => (
              <Property key={label} label={label}>
                <span className="tabular-nums">
                  {money(value, forecast.currency)}
                </span>
              </Property>
            ))}
          </Properties>
        </Section>
      </aside>
    </div>
  );
}

type LinkMode = "bank" | "csv";

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
  const [mode, setMode] = useState<LinkMode>("bank");
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

  async function link(institution: FinanceInstitution) {
    setLinking(institution.id);
    try {
      const result = await beginFinanceLink(client, {
        institutionId: institution.id,
      });
      onNavigate(result.linkUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Link failed");
    } finally {
      setLinking(null);
    }
  }

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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add account"
      onSubmit={mode === "bank" ? search : importCsv}
      submitLabel={mode === "bank" ? "Search" : "Import"}
      pending={mode === "bank" ? loading : importing}
      submitDisabled={mode === "csv" && (!csvName.trim() || !csvText.trim())}
      footerStart={
        mode === "csv" ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {csvRows} rows
          </span>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {filtered.length} institutions
          </span>
        )
      }
    >
      <FilterTabs<LinkMode>
        value={mode}
        onChange={setMode}
        options={[
          { value: "bank", label: "Bank" },
          { value: "csv", label: "CSV" },
        ]}
      />
      {mode === "bank" ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <CountrySelect
              value={country}
              onValueChange={setCountry}
              className="w-48 shrink-0"
            />
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Filter"
              className="h-8 flex-1"
            />
          </div>
          {loading && institutions.length === 0 ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState compact icon={<Landmark />} label="No institutions" />
          ) : (
            <List divided className="px-2">
              {filtered.map((institution) => (
                <ListRow
                  key={institution.id}
                  onClick={
                    linking === null ? () => void link(institution) : undefined
                  }
                  className={cn(
                    linking !== null &&
                      linking !== institution.id &&
                      "opacity-40",
                  )}
                  leading={<Landmark />}
                  title={institution.name}
                  meta={
                    linking === institution.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      institution.country
                    )
                  }
                />
              ))}
            </List>
          )}
        </>
      ) : (
        <>
          <FormGrid>
            <FormField label="Name" htmlFor="csv-name">
              <Input
                id="csv-name"
                value={csvName}
                onChange={(event) => setCsvName(event.target.value)}
              />
            </FormField>
            <FormField label="Currency">
              <CurrencySelect
                value={csvCurrency}
                onValueChange={setCsvCurrency}
              />
            </FormField>
            <FormField
              label="File"
              htmlFor="csv-file"
              className="sm:col-span-2"
            >
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
            </FormField>
          </FormGrid>
          <FormField label="Rows" htmlFor="csv-text">
            <Textarea
              id="csv-text"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              rows={12}
              className="font-mono text-[11px]"
            />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}
