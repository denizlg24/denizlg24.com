import { Row, Section, Stack, Text } from "@repo/native-ui";
import type {
  FinanceDashboardResponse,
  FinanceForecast,
  FinanceRecurringRule,
} from "@repo/schemas";
import {
  describeRecurrence,
  formatMoney,
  nextRecurringOccurrences,
} from "@repo/utils";
import { Dash } from "@/features/shell/tab-page";
import { dayLabel, isoDay } from "@/lib/format";

/** The desktop's Forecast tab in one line: the month-end range and the daily allowance. */
export function ForecastLine({ forecast }: { forecast: FinanceForecast }) {
  const money = (minor: number) => formatMoney(minor, forecast.currency);
  return (
    <Text variant="footnote" tone="secondary" figure>
      {money(forecast.p25Minor)} – {money(forecast.p75Minor)} at month end ·{" "}
      {money(forecast.discretionaryDailyRateMinor)}/day for{" "}
      {forecast.daysRemaining} days ·{" "}
      {money(forecast.recurringExpensesDueMinor)} still due,{" "}
      {money(forecast.expectedIncomeMinor)} expected
    </Text>
  );
}

function RuleRow({
  rule,
  today,
  last,
}: {
  rule: FinanceRecurringRule;
  today: string;
  last: boolean;
}) {
  const next =
    rule.status === "active"
      ? nextRecurringOccurrences(rule, today, 1)[0]
      : null;
  const amount = formatMoney(
    rule.direction === "expense" ? -rule.amountMinor : rule.amountMinor,
    rule.currency,
  );
  return (
    <Row
      title={rule.name}
      subtitle={[
        describeRecurrence(rule.recurrence),
        rule.status === "paused" ? "paused" : next ? dayLabel(next) : "ended",
        rule.amountKind === "variable" ? "variable" : null,
        rule.payout ? "payout" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      value={amount}
      valueTone={
        rule.status === "paused"
          ? "tertiary"
          : rule.direction === "income"
            ? "working"
            : "primary"
      }
      separator={!last}
    />
  );
}

/** The desktop's Recurring tab: what the month is committed to, rule by rule, soonest first. */
export function Recurring({ finance }: { finance: FinanceDashboardResponse }) {
  const today = isoDay(new Date());
  const commitment = finance.recurringCommitment;
  const nextOf = (rule: FinanceRecurringRule) =>
    rule.status === "active"
      ? (nextRecurringOccurrences(rule, today, 1)[0] ?? "9999")
      : "9999";
  const sorted = [...finance.recurringRules].sort(
    (a, b) =>
      Number(a.status === "paused") - Number(b.status === "paused") ||
      nextOf(a).localeCompare(nextOf(b)),
  );
  const out = sorted.filter((rule) => rule.direction === "expense");
  const income = sorted.filter((rule) => rule.direction === "income");

  return (
    <Stack>
      <Text variant="footnote" tone="secondary" figure>
        {formatMoney(commitment.expenseMinor, commitment.currency)} out ·{" "}
        {formatMoney(commitment.incomeMinor, commitment.currency)} in, per month
        {commitment.unconvertedByCurrency.length
          ? ` · ${commitment.unconvertedByCurrency.length} currency not converted`
          : ""}
      </Text>
      <Section title="Out">
        {out.length === 0 ? <Dash /> : null}
        {out.map((rule, index) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            today={today}
            last={index === out.length - 1}
          />
        ))}
      </Section>
      <Section title="In">
        {income.length === 0 ? <Dash /> : null}
        {income.map((rule, index) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            today={today}
            last={index === income.length - 1}
          />
        ))}
      </Section>
    </Stack>
  );
}
