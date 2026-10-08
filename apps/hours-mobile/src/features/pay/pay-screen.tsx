import type { FinancePayoutPeriod, WorkPayPeriod } from "@repo/schemas";
import { formatMinutes, formatMoney } from "@repo/utils";
import { format } from "date-fns";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useOverview, usePayouts } from "@/api/hours";
import { Notice, PageHeader, Row, Screen, Section, spacing, Text } from "@/ui";
import { PayPeriodSummary } from "../clock/clock-screen";

const short = (day: string) => format(new Date(`${day}T12:00:00`), "d MMM");

export function PayScreen() {
  const overview = useOverview();
  const periods = overview.data?.payPeriods ?? [];
  return (
    <Screen
      onRefresh={() => void overview.refetch()}
      refreshing={overview.isRefetching}
    >
      <PageHeader title="Pay" />
      {overview.error ? <Notice message={overview.error.message} /> : null}
      {!overview.data ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : periods.length === 0 ? (
        <Text tone="secondary" align="center" style={styles.loading}>
          —
        </Text>
      ) : (
        <View style={{ gap: spacing.xxxl }}>
          {periods.map((period) => (
            <PayRule key={period.ruleId} period={period} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function PayRule({ period }: { period: WorkPayPeriod }) {
  const schedule = usePayouts(period.ruleId);
  return (
    <View style={{ gap: spacing.lg }}>
      <PayPeriodSummary period={period} />
      {period.lines.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          {period.lines.map((line) => (
            <View key={line.lineId} style={styles.line}>
              <Text
                variant="footnote"
                tone="secondary"
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {line.name}
              </Text>
              <Text variant="footnote" figure>
                −{formatMoney(line.amountMinor, period.currency)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Section title="Payouts">
        {schedule.error ? <Notice message={schedule.error.message} /> : null}
        {!schedule.data ? (
          <ActivityIndicator style={{ paddingVertical: spacing.lg }} />
        ) : (
          [...schedule.data.periods]
            .reverse()
            .slice(0, 12)
            .map((row, index, rows) => (
              <PayoutRow
                key={row.payoutDate}
                period={row}
                separator={index < rows.length - 1}
              />
            ))
        )}
      </Section>
    </View>
  );
}

function PayoutRow({
  period,
  separator,
}: {
  period: FinancePayoutPeriod;
  separator: boolean;
}) {
  const variance =
    period.varianceMinor !== undefined && period.varianceMinor !== 0
      ? `${period.varianceMinor > 0 ? "+" : "−"}${formatMoney(Math.abs(period.varianceMinor), period.currency)}`
      : undefined;
  return (
    <Row
      title={short(period.payoutDate)}
      subtitle={[
        period.phase,
        `${formatMinutes(period.loggedMinutes)} h`,
        `${short(period.periodStart)} – ${short(period.periodEnd)}`,
        variance,
      ]
        .filter(Boolean)
        .join(" · ")}
      value={formatMoney(
        period.actual?.amountMinor ?? period.netMinor,
        period.currency,
      )}
      valueTone={period.phase === "paid" ? "primary" : "secondary"}
      separator={separator}
    />
  );
}

const styles = StyleSheet.create({
  loading: { paddingTop: 80, alignItems: "center" },
  line: { flexDirection: "row", gap: spacing.md },
});
