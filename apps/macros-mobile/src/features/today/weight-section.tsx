import type {
  MacrosWeightSummary,
  MacrosWeightTrendPoint,
} from "@repo/schemas/macros";
import { Pressable, StyleSheet, View } from "react-native";
import { shiftIsoDate } from "@/lib/day";
import {
  formatDayLabel,
  formatDecimal,
  formatWeight,
  formatWeightDelta,
  type WeightUnit,
  weightValue,
} from "@/lib/format";
import { Button, Flash, Section, spacing, Text } from "@/ui";
import { recentTrend, type WeightSparkPoint } from "./logic";
import { WeightSparkline } from "./weight-sparkline";

export interface WeightSectionProps {
  summary: MacrosWeightSummary;
  /** From the weight overview; absent until it has loaded once. */
  trend: MacrosWeightTrendPoint[] | undefined;
  unit: WeightUnit;
  today: string;
  onOpen: () => void;
  onWeighIn: () => void;
}

function latestTrendPoint(
  trend: MacrosWeightTrendPoint[] | undefined,
  today: string,
): MacrosWeightTrendPoint | null {
  let latest: MacrosWeightTrendPoint | null = null;
  for (const point of trend ?? []) {
    if (point.date <= today && (latest === null || point.date > latest.date)) {
      latest = point;
    }
  }
  return latest;
}

export function WeightSection({
  summary,
  trend,
  unit,
  today,
  onOpen,
  onWeighIn,
}: WeightSectionProps) {
  const weighedToday = summary.latestLogDate === today;
  const action = weighedToday
    ? { label: "Progress", onPress: onOpen }
    : { label: "Weigh in", onPress: onWeighIn };

  const current = latestTrendPoint(trend, today);
  const trendSpark = recentTrend(trend ?? [], today, shiftIsoDate(today, -29));
  const spark: WeightSparkPoint[] =
    trendSpark.length > 1
      ? trendSpark
      : summary.lastSevenEntries.map((point) => ({
          date: point.date,
          trendKg: point.weightKg,
          scaleKg: null,
        }));

  const headline = current
    ? { label: "Trend", kg: current.trendWeightKg }
    : summary.latestWeightKg !== null
      ? { label: "Latest", kg: summary.latestWeightKg }
      : null;

  if (headline === null) {
    return (
      <Section title="Weight">
        <View style={styles.empty}>
          <Text variant="subheadline" tone="secondary" style={styles.emptyText}>
            Weigh in a few mornings a week and your trend shows up here.
          </Text>
          <Button
            label="Weigh in"
            icon="scale"
            variant="tinted"
            size="small"
            onPress={onWeighIn}
          />
        </View>
      </Section>
    );
  }

  const rate =
    current?.slopeKgPerWeek != null
      ? `${formatWeightDelta(current.slopeKgPerWeek, unit)} per week`
      : summary.weekDifferenceKg !== null
        ? `${formatWeightDelta(summary.weekDifferenceKg, unit)} vs last week`
        : null;
  const scale =
    summary.latestWeightKg !== null && summary.latestLogDate !== null
      ? `Scale ${formatWeight(summary.latestWeightKg, unit)} · ${formatDayLabel(summary.latestLogDate, today)}`
      : null;
  const figure = formatDecimal(weightValue(headline.kg, unit));

  return (
    <Section title="Weight" action={action}>
      <Flash token={`${summary.latestLogDate}:${summary.latestWeightKg}`}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={[
            `${headline.label} weight ${figure} ${unit}`,
            rate,
            scale,
          ]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint="Opens Progress"
          style={({ pressed }) => [styles.block, pressed && styles.pressed]}
        >
          <View style={styles.text}>
            <Text variant="caption1" tone="secondary" eyebrow>
              {headline.label}
            </Text>
            <View style={styles.figureRow}>
              <Text variant="title2" figure>
                {figure}
              </Text>
              <Text variant="footnote" tone="secondary">
                {unit}
              </Text>
            </View>
            {rate ? (
              <Text variant="footnote" tone="secondary" figure>
                {rate}
              </Text>
            ) : null}
            {scale ? (
              <Text variant="footnote" tone="tertiary" figure>
                {scale}
              </Text>
            ) : null}
          </View>
          <View style={styles.chart}>
            <WeightSparkline points={spark} />
          </View>
        </Pressable>
      </Flash>
    </Section>
  );
}

const styles = StyleSheet.create({
  block: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  figureRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  chart: {
    width: "42%",
  },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  emptyText: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
