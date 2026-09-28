import type {
  MacrosFoodLogDayStatus,
  MacrosFoodLoggingSummary,
  MacrosWeightSummary,
} from "@repo/schemas/macros";
import { type ColorValue, Pressable, StyleSheet, View } from "react-native";
import { colors, Hairline, Section, spacing, Text } from "@/ui";
import { loggingStreak } from "./logic";

const CELL_GAP = 2;

const statusColor: Record<MacrosFoodLogDayStatus, ColorValue> = {
  full: colors.label,
  partial: colors.secondaryLabel,
  empty: colors.fill,
};

function DayCells({
  cells,
}: {
  cells: ReadonlyArray<{ key: string; color: ColorValue }>;
}) {
  return (
    <View style={styles.cells} accessibilityElementsHidden>
      {cells.map((cell) => (
        <View
          key={cell.key}
          style={[styles.cell, { backgroundColor: cell.color }]}
        />
      ))}
    </View>
  );
}

function streakLabel(days: number, capped: boolean): string {
  if (days === 0) return "No streak";
  return `${days}${capped ? "+" : ""}-day streak`;
}

function StreakRow({
  title,
  streak,
  detail,
  cells,
  onPress,
}: {
  title: string;
  streak: string;
  detail: string;
  cells: ReadonlyArray<{ key: string; color: ColorValue }>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${streak}, ${detail}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowHeader}>
        <Text variant="subheadline" weight="semibold" style={styles.rowTitle}>
          {title}
        </Text>
        <Text variant="subheadline" figure>
          {streak}
        </Text>
      </View>
      <DayCells cells={cells} />
      <Text variant="footnote" tone="secondary" figure>
        {detail}
      </Text>
    </Pressable>
  );
}

export interface StreaksSectionProps {
  foodLogging: MacrosFoodLoggingSummary;
  weight: MacrosWeightSummary;
  today: string;
  onOpenLog: () => void;
  onOpenProgress: () => void;
}

export function StreaksSection({
  foodLogging,
  weight,
  today,
  onOpenLog,
  onOpenProgress,
}: StreaksSectionProps) {
  const food = loggingStreak(foodLogging.last30Days, today);
  const foodCells = [...foodLogging.last30Days]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((day) => ({ key: day.date, color: statusColor[day.status] }));

  const tracked = new Set(weight.trackedLast30Days);
  const weighInCells = weight.last30Days.map((date) => ({
    key: date,
    color: tracked.has(date) ? colors.label : colors.fill,
  }));

  return (
    <Section title="Last 30 days">
      <StreakRow
        title="Food logging"
        streak={streakLabel(food.days, food.capped)}
        detail={`${foodLogging.fullThisWeek} full · ${foodLogging.partialThisWeek} partial this week`}
        cells={foodCells}
        onPress={onOpenLog}
      />
      <Hairline />
      <StreakRow
        title="Weigh-ins"
        streak={streakLabel(weight.streakDays, weight.streakDays >= 30)}
        detail={`${weight.weighInsThisWeek} of 7 this week`}
        cells={weighInCells}
        onPress={onOpenProgress}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
  },
  cells: {
    flexDirection: "row",
    gap: CELL_GAP,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 1.5,
  },
  pressed: {
    opacity: 0.6,
  },
});
