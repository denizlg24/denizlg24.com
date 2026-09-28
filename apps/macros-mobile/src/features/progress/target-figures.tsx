import type { MacrosPlanDetail } from "@repo/schemas/macros";
import { StyleSheet, View } from "react-native";
import { MacroInline } from "@/components/macro-bars";
import { type EnergyUnit, formatEnergy, formatInteger } from "@/lib/format";
import { Hairline, macroColors, spacing, Text } from "@/ui";
import { planWeekdayNames } from "./labels";

const MACROS = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
] as const;

/** Protein, carbs and fat targets, each under a short rule in its macro hue. */
export function MacroTargets({
  protein,
  carbs,
  fat,
}: {
  protein: number;
  carbs: number;
  fat: number;
}) {
  const grams = { protein, carbs, fat };
  return (
    <View style={styles.macros}>
      {MACROS.map(({ key, label }) => (
        <View key={key} style={styles.macro}>
          <View style={[styles.rule, { backgroundColor: macroColors[key] }]} />
          <Text variant="caption1" tone="secondary" eyebrow>
            {label}
          </Text>
          <View style={styles.value}>
            <Text variant="title3" figure>
              {formatInteger(grams[key])}
            </Text>
            <Text variant="footnote" tone="secondary">
              g
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Day-specific targets of the current issue, Monday first. Without calorie
 * cycling every day is the same, which collapses to one line.
 */
export function DayTargets({
  days,
  todayWeekday,
  energyUnit,
}: {
  days: MacrosPlanDetail["days"];
  todayWeekday: number;
  energyUnit: EnergyUnit;
}) {
  const sorted = [...days].sort((a, b) => a.weekday - b.weekday);
  const calories = new Set(
    sorted.map((day) => Math.round(day.calorieTarget ?? 0)),
  );
  if (sorted.length === 0) return null;
  if (calories.size === 1) {
    return (
      <Text variant="footnote" tone="secondary">
        The same targets every day of the week.
      </Text>
    );
  }
  return (
    <View>
      {sorted.map((day, index) => {
        const today = day.weekday === todayWeekday;
        return (
          <View key={day.weekday}>
            <View style={styles.dayRow}>
              <Text
                variant="subheadline"
                weight={today ? "semibold" : "regular"}
                style={styles.dayName}
                accessibilityLabel={
                  today ? `${planWeekdayNames[day.weekday]}, today` : undefined
                }
              >
                {planWeekdayNames[day.weekday]?.slice(0, 3)}
              </Text>
              <View style={styles.dayMacros}>
                <MacroInline
                  protein={day.proteinTarget ?? 0}
                  carbs={day.carbsTarget ?? 0}
                  fat={day.fatTarget ?? 0}
                />
              </View>
              <Text
                variant="subheadline"
                weight={today ? "semibold" : "regular"}
                figure
              >
                {day.calorieTarget == null
                  ? "—"
                  : formatEnergy(day.calorieTarget, energyUnit)}
              </Text>
            </View>
            {index < sorted.length - 1 ? <Hairline /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  macros: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  macro: {
    flex: 1,
    gap: spacing.xs,
  },
  rule: {
    width: 16,
    height: 3,
    borderRadius: 1.5,
  },
  value: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xxs,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  dayName: {
    minWidth: 40,
  },
  dayMacros: {
    flex: 1,
  },
});
