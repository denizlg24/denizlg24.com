import {
  colors,
  haptics,
  Notice,
  Row,
  Section,
  Stat,
  spacing,
  Text,
} from "@repo/native-ui";
import type {
  FinanceBudgetOverview,
  FinanceDashboardResponse,
  FinanceEnvelopeStatus,
  FinanceLedgerEntry,
} from "@repo/schemas";
import { pickDisplayBalance } from "@repo/schemas";
import type { Quote } from "@repo/schemas/markets";
import { formatMoney } from "@repo/utils";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  QUOTE_FRESH_MS,
  useBudget,
  useDecideAlert,
  useDecideMatch,
  useFinance,
  usePortfolios,
  useQuotes,
  useWatchlists,
} from "@/api/money";
import { Segments } from "@/features/shell/segments";
import { severityTone } from "@/features/shell/status";
import { SwipeRow } from "@/features/shell/swipe-row";
import { Dash, QueryState, TabPage } from "@/features/shell/tab-page";
import { dayLabel } from "@/lib/format";
import { changePercent, signedPercent } from "./quotes";
import { ForecastLine, Recurring } from "./recurring";

type View_ = "overview" | "recurring" | "budget" | "markets";

export function MoneyScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const router = useRouter();
  const view: View_ =
    params.view === "recurring" ||
    params.view === "budget" ||
    params.view === "markets"
      ? params.view
      : "overview";
  const finance = useFinance();
  const budget = useBudget();
  const watchlists = useWatchlists();
  const [watchlistId, setWatchlistId] = useState<string>();
  const watchlist =
    watchlists.data?.find((item) => item.id === watchlistId) ??
    watchlists.data?.[0];
  const quotes = useQuotes(
    view === "markets" ? (watchlist?.tickers ?? []) : [],
  );

  const refresh = () => {
    if (view === "overview" || view === "recurring") void finance.refetch();
    if (view === "budget") void budget.refetch();
    // Inside the minute, a pull reuses the quotes already held.
    if (
      view === "markets" &&
      Date.now() - quotes.dataUpdatedAt > QUOTE_FRESH_MS
    ) {
      void quotes.refetch();
    }
  };

  return (
    <TabPage
      title="Money"
      onRefresh={refresh}
      refreshing={finance.isRefetching || budget.isRefetching}
    >
      <Segments
        value={view}
        onChange={(next) => router.setParams({ view: next })}
        options={[
          {
            value: "overview",
            label: "Overview",
            count: finance.data?.matchReviews.filter(
              (review) => review.status === "pending",
            ).length,
          },
          { value: "recurring", label: "Recurring" },
          {
            value: "budget",
            label: "Budget",
            count: budget.data?.alerts.filter(
              (alert) => alert.status === "open",
            ).length,
          },
          { value: "markets", label: "Markets" },
        ]}
      />
      {view === "overview" ? (
        <>
          <QueryState error={finance.error} loading={!finance.data} />
          {finance.data ? <Overview finance={finance.data} /> : null}
        </>
      ) : view === "recurring" ? (
        <>
          <QueryState error={finance.error} loading={!finance.data} />
          {finance.data ? <Recurring finance={finance.data} /> : null}
        </>
      ) : view === "budget" ? (
        <>
          <QueryState error={budget.error} loading={!budget.data} />
          {budget.data ? <Budget budget={budget.data} /> : null}
        </>
      ) : (
        <Markets
          watchlists={watchlists.data ?? []}
          watchlistId={watchlist?.id}
          onWatchlist={setWatchlistId}
          quotes={quotes.data?.quotes ?? []}
          stale={quotes.data?.stale ?? false}
          error={watchlists.error ?? quotes.error}
          loading={!watchlists.data || (quotes.isFetching && !quotes.data)}
        />
      )}
    </TabPage>
  );
}

function entryLine(entry: FinanceLedgerEntry | undefined) {
  if (!entry) return "—";
  return `${entry.descriptor} · ${formatMoney(entry.amountMinor, entry.currency)} · ${dayLabel(entry.effectiveDate)}`;
}

function Overview({ finance }: { finance: FinanceDashboardResponse }) {
  const router = useRouter();
  const decide = useDecideMatch();
  const byId = new Map(finance.ledger.map((entry) => [entry.id, entry]));
  const reviews = finance.matchReviews.filter(
    (review) => review.status === "pending",
  );
  const balance = (accountId: string) =>
    pickDisplayBalance(finance.balances, accountId);
  const recent = finance.ledger
    .filter((entry) => entry.origin !== "projected" && entry.state !== "void")
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    .slice(0, 40);
  const { monthly } = finance;

  return (
    <View style={{ gap: spacing.xxl }}>
      <View style={styles.stats}>
        <Stat
          label="In"
          value={formatMoney(monthly.incomeMinor, monthly.currency)}
        />
        <Stat
          label="Out"
          value={formatMoney(monthly.spendMinor, monthly.currency)}
        />
        {finance.forecast ? (
          <Stat
            label="Month end"
            value={formatMoney(
              finance.forecast.p50Minor,
              finance.forecast.currency,
            )}
          />
        ) : null}
      </View>
      {finance.forecast ? <ForecastLine forecast={finance.forecast} /> : null}

      <Section title="Accounts">
        {finance.accounts.map((account, index) => {
          const row = balance(account.id);
          return (
            <Row
              key={account.id}
              title={account.displayName}
              subtitle={
                account.connection.status === "active"
                  ? account.institutionName
                  : `${account.institutionName} · ${account.connection.status}`
              }
              value={row ? formatMoney(row.amountMinor, row.currency) : "—"}
              valueTone="primary"
              separator={index < finance.accounts.length - 1}
            />
          );
        })}
      </Section>

      {reviews.length > 0 ? (
        <Section title="Review">
          {decide.error ? <Notice message={decide.error.message} /> : null}
          {reviews.map((review) => (
            <SwipeRow
              key={review.id}
              right={{
                label: "Match",
                symbol: "link",
                color: colors.working,
                run: () => decide.mutate({ id: review.id, action: "accept" }),
              }}
              left={{
                label: "Not it",
                symbol: "xmark",
                color: colors.secondaryLabel,
                run: () => decide.mutate({ id: review.id, action: "reject" }),
              }}
            >
              <View style={styles.review}>
                <Text variant="subheadline" numberOfLines={1}>
                  {entryLine(byId.get(review.sourceLedgerId))}
                </Text>
                <Text variant="footnote" tone="secondary" numberOfLines={1}>
                  ↔ {entryLine(byId.get(review.candidateBankLedgerId))}
                </Text>
                <Text variant="caption1" tone="tertiary" figure>
                  {Math.round(review.confidence * 100)}%
                </Text>
              </View>
              <View style={styles.rule} />
            </SwipeRow>
          ))}
        </Section>
      ) : null}

      <Section title="Recent">
        {recent.length === 0 ? <Dash /> : null}
        {recent.map((entry, index) => (
          <Row
            key={entry.id}
            title={entry.descriptor}
            subtitle={`${dayLabel(entry.effectiveDate)}${entry.category ? ` · ${entry.category}` : ""}${entry.origin === "bank" && entry.state === "pending" ? " · pending" : ""}`}
            value={formatMoney(entry.amountMinor, entry.currency)}
            valueTone={entry.amountMinor > 0 ? "working" : "primary"}
            separator={index < recent.length - 1}
            onPress={() => router.push(`/money/entry/${entry.id}`)}
          />
        ))}
      </Section>
    </View>
  );
}

export function EnvelopeLine({
  status,
  onPress,
  separator = true,
}: {
  status: FinanceEnvelopeStatus;
  onPress?: () => void;
  separator?: boolean;
}) {
  const fraction =
    status.limitMinor > 0
      ? Math.min(1, Math.max(0, status.spentMinor / status.limitMinor))
      : 0;
  const over = status.availableMinor < 0;
  return (
    <Row
      title={status.name}
      subtitle={`${formatMoney(status.spentMinor, status.currency)} of ${formatMoney(status.limitMinor + status.carryInMinor, status.currency)}`}
      value={formatMoney(status.availableMinor, status.currency)}
      valueTone={over ? "primary" : "secondary"}
      destructive={over}
      separator={separator}
      onPress={onPress}
      trailing={
        <View style={styles.meter}>
          <View
            style={[
              styles.meterFill,
              {
                width: `${fraction * 100}%`,
                backgroundColor: over ? colors.destructive : colors.label,
              },
            ]}
          />
        </View>
      }
    />
  );
}

function Budget({ budget }: { budget: FinanceBudgetOverview }) {
  const router = useRouter();
  const decide = useDecideAlert();
  const open = budget.alerts.filter((alert) => alert.status === "open");
  const { totals } = budget;
  return (
    <View style={{ gap: spacing.xxl }}>
      <View style={styles.stats}>
        <Stat
          label="Left"
          value={formatMoney(totals.availableMinor, totals.currency)}
        />
        <Stat
          label="Spent"
          value={formatMoney(totals.spentMinor, totals.currency)}
        />
        <Stat
          label="Planned"
          value={formatMoney(totals.plannedMinor, totals.currency)}
        />
      </View>

      {open.length > 0 ? (
        <Section title="Alerts">
          {decide.error ? <Notice message={decide.error.message} /> : null}
          {open.map((alert) => (
            <SwipeRow
              key={alert.id}
              right={{
                label: "Seen",
                symbol: "checkmark",
                color: colors.secondaryLabel,
                run: () => {
                  haptics.selection();
                  decide.mutate({ id: alert.id, action: "acknowledge" });
                },
              }}
            >
              <Row
                title={alert.title}
                subtitle={alert.detail}
                trailing={
                  <Text variant="footnote" tone={severityTone(alert.severity)}>
                    {alert.severity}
                  </Text>
                }
                onPress={
                  alert.envelopeId
                    ? () => router.push(`/money/envelope/${alert.envelopeId}`)
                    : undefined
                }
              />
            </SwipeRow>
          ))}
        </Section>
      ) : null}

      <Section title="Envelopes">
        {budget.statuses.length === 0 ? <Dash /> : null}
        {budget.statuses.map((status, index) => (
          <EnvelopeLine
            key={status.envelopeId}
            status={status}
            separator={index < budget.statuses.length - 1}
            onPress={() => router.push(`/money/envelope/${status.envelopeId}`)}
          />
        ))}
      </Section>

      {budget.unbudgeted.length > 0 ? (
        <Section title="Unbudgeted">
          {budget.unbudgeted.slice(0, 8).map((row, index, rows) => (
            <Row
              key={row.category ?? "none"}
              title={row.category ?? "Uncategorized"}
              value={formatMoney(row.spentMinor, budget.currency)}
              separator={index < rows.length - 1}
            />
          ))}
        </Section>
      ) : null}
    </View>
  );
}

function Markets({
  watchlists,
  watchlistId,
  onWatchlist,
  quotes,
  stale,
  error,
  loading,
}: {
  watchlists: { id: string; name: string; tickers: string[] }[];
  watchlistId: string | undefined;
  onWatchlist: (id: string) => void;
  quotes: Quote[];
  stale: boolean;
  error: Error | null;
  loading: boolean;
}) {
  const router = useRouter();
  const portfolios = usePortfolios();
  const tickers =
    watchlists.find((item) => item.id === watchlistId)?.tickers ?? [];
  const byTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));
  return (
    <View style={{ gap: spacing.xxl }}>
      <Section title="Portfolios">
        <QueryState error={portfolios.error} loading={!portfolios.data} />
        {portfolios.data?.map((portfolio, index, rows) => (
          <Row
            key={portfolio.id}
            title={portfolio.name}
            chevron
            separator={index < rows.length - 1}
            onPress={() => router.push(`/money/portfolio/${portfolio.id}`)}
          />
        ))}
      </Section>

      <Section title={stale ? "Watchlist · delayed" : "Watchlist"}>
        {watchlists.length > 1 ? (
          <Segments
            value={watchlistId ?? ""}
            onChange={onWatchlist}
            options={watchlists.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        ) : null}
        <QueryState error={error} loading={loading} />
        {!loading && tickers.length === 0 ? <Dash /> : null}
        {tickers.map((ticker, index) => {
          const quote = byTicker.get(ticker);
          const change = quote ? changePercent(quote) : null;
          return (
            <Row
              key={ticker}
              title={ticker}
              value={quote?.last != null ? quote.last.toFixed(2) : "—"}
              valueTone="primary"
              separator={index < tickers.length - 1}
              trailing={
                <Text
                  variant="footnote"
                  figure
                  tone={
                    change === null
                      ? "tertiary"
                      : change >= 0
                        ? "working"
                        : "destructive"
                  }
                  style={styles.change}
                >
                  {signedPercent(change)}
                </Text>
              }
            />
          );
        })}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: spacing.md },
  review: { paddingVertical: spacing.md, gap: 2 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  meter: {
    width: 44,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.tertiaryFill,
    overflow: "hidden",
  },
  meterFill: { height: 3 },
  change: { width: 64, textAlign: "right" },
});
