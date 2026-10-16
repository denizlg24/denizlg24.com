import {
  Stack as Gap,
  Row,
  Screen,
  Section,
  Stat,
  spacing,
} from "@repo/native-ui";
import { formatMoney } from "@repo/utils";
import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useBudget } from "@/api/money";
import { QueryState } from "@/features/shell/tab-page";
import { dayLabel } from "@/lib/format";

/** Read-only: limits and categories are edited on web. */
export function EnvelopeScreen({ id }: { id: string }) {
  const budget = useBudget();
  const status = budget.data?.statuses.find((row) => row.envelopeId === id);
  const envelope = budget.data?.envelopes.find((row) => row.id === id);
  const alerts =
    budget.data?.alerts.filter(
      (alert) => alert.envelopeId === id && alert.status !== "resolved",
    ) ?? [];
  const money = (minor: number) =>
    formatMoney(minor, status?.currency ?? budget.data?.currency ?? "EUR");

  return (
    <Screen>
      <Stack.Screen options={{ title: status?.name ?? envelope?.name ?? "" }} />
      <QueryState error={budget.error} loading={!budget.data} />
      {status ? (
        <Gap>
          <View style={styles.stats}>
            <Stat label="Left" value={money(status.availableMinor)} />
            <Stat label="Spent" value={money(status.spentMinor)} />
            <Stat label="Projected" value={money(status.projectedMinor)} />
          </View>
          <Section title="Period">
            <Row
              title={`${dayLabel(status.periodStart)} – ${dayLabel(status.periodEnd)}`}
              value={`${Math.round(status.elapsedFraction * 100)}%`}
            />
            <Row title="Limit" value={money(status.limitMinor)} />
            {status.carryInMinor !== 0 ? (
              <Row title="Carried in" value={money(status.carryInMinor)} />
            ) : null}
            <Row title="Committed" value={money(status.committedMinor)} />
            {status.refundedMinor > 0 ? (
              <Row title="Refunded" value={money(status.refundedMinor)} />
            ) : null}
            <Row
              title="Pace"
              value={
                status.paceRatio === null
                  ? "—"
                  : `${status.paceRatio.toFixed(2)}×`
              }
              separator={false}
            />
          </Section>
          {alerts.length > 0 ? (
            <Section title="Alerts">
              {alerts.map((alert, index) => (
                <Row
                  key={alert.id}
                  title={alert.title}
                  subtitle={alert.detail}
                  separator={index < alerts.length - 1}
                />
              ))}
            </Section>
          ) : null}
          {envelope && envelope.categories.length > 0 ? (
            <Section title="Categories">
              {envelope.categories.map((category, index) => (
                <Row
                  key={category}
                  title={category}
                  separator={index < envelope.categories.length - 1}
                />
              ))}
            </Section>
          ) : null}
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: spacing.md },
});
