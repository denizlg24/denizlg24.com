import { isoToDate, weekDaysFor } from "@repo/macros-core/food-log/date-utils";
import type { MacrosWeekTotals } from "@repo/schemas/macros";
import { format } from "date-fns";
import { Pressable, StyleSheet, View } from "react-native";
import {
  Directions,
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import { colors, Icon, spacing, Text } from "@/ui";
import { DayRing } from "./day-ring";

export interface WeekStripProps {
  selectedDate: string;
  today: string;
  totals: MacrosWeekTotals | undefined;
  energyUnit: EnergyUnit;
  onSelect: (date: string) => void;
  /** -1 for the previous week, 1 for the next. */
  onShiftWeek: (direction: -1 | 1) => void;
}

function weekTitle(first: string, last: string): string {
  const start = isoToDate(first);
  const end = isoToDate(last);
  if (format(start, "yyyy-MM") === format(end, "yyyy-MM")) {
    return format(start, "MMMM yyyy");
  }
  if (format(start, "yyyy") === format(end, "yyyy")) {
    return `${format(start, "MMM")} – ${format(end, "MMM yyyy")}`;
  }
  return `${format(start, "MMM yyyy")} – ${format(end, "MMM yyyy")}`;
}

export function WeekStrip({
  selectedDate,
  today,
  totals,
  energyUnit,
  onSelect,
  onShiftWeek,
}: WeekStripProps) {
  const week = weekDaysFor(selectedDate);
  const first = week[0]?.iso ?? selectedDate;
  const last = week[week.length - 1]?.iso ?? selectedDate;
  const caloriesByDate = new Map(
    totals?.days.map((day) => [day.date, day.calories]) ?? [],
  );
  const target = totals?.calorieTarget ?? null;
  const canGoForward = last < today;

  const swipe = Gesture.Race(
    Gesture.Fling()
      .direction(Directions.RIGHT)
      .runOnJS(true)
      .onEnd(() => onShiftWeek(-1)),
    Gesture.Fling()
      .direction(Directions.LEFT)
      .runOnJS(true)
      .onEnd(() => {
        if (canGoForward) onShiftWeek(1);
      }),
  );

  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text
            variant="footnote"
            tone="secondary"
            eyebrow
            style={styles.title}
          >
            {weekTitle(first, last)}
          </Text>
          <Pressable
            onPress={() => onShiftWeek(-1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <Icon
              name="chevron-left"
              size={15}
              weight="semibold"
              color={colors.secondaryLabel}
            />
          </Pressable>
          <Pressable
            onPress={() => onShiftWeek(1)}
            disabled={!canGoForward}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Next week"
            accessibilityState={{ disabled: !canGoForward }}
            style={!canGoForward && styles.disabled}
          >
            <Icon
              name="chevron-right"
              size={15}
              weight="semibold"
              color={colors.secondaryLabel}
            />
          </Pressable>
        </View>

        <View style={styles.days}>
          {week.map((day) => {
            const future = day.iso > today;
            const calories = caloriesByDate.get(day.iso) ?? 0;
            const progress = target && target > 0 ? calories / target : null;
            return (
              <Pressable
                key={day.iso}
                disabled={future}
                onPress={() => onSelect(day.iso)}
                style={styles.day}
                accessibilityRole="button"
                accessibilityState={{
                  selected: day.iso === selectedDate,
                  disabled: future,
                }}
                accessibilityLabel={`${format(isoToDate(day.iso), "EEEE d MMMM")}, ${formatEnergy(calories, energyUnit)} ${energyLabel(energyUnit)}`}
              >
                <Text
                  variant="caption2"
                  weight="semibold"
                  tone={day.iso === selectedDate ? "primary" : "tertiary"}
                >
                  {day.letter}
                </Text>
                <DayRing
                  day={day.num}
                  progress={progress}
                  selected={day.iso === selectedDate}
                  today={day.iso === today}
                  disabled={future}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  title: {
    flex: 1,
  },
  days: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  day: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.3,
  },
});
