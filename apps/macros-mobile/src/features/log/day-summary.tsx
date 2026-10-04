import type { MacrosFoodLogDay } from "@repo/schemas/macros";
import { StyleSheet, View } from "react-native";
import { MacroBars } from "@/components/macro-bars";
import {
  type EnergyUnit,
  energyLabel,
  formatEnergy,
  formatInteger,
} from "@/lib/format";
import { colors, gutter, Meter, macroColors, spacing, Text } from "@/ui";

/** Calories against the day's target, then the three macros under it. */
export function DaySummary({
  day,
  energyUnit,
}: {
  day: Pick<MacrosFoodLogDay, "totals" | "targets">;
  energyUnit: EnergyUnit;
}) {
  const { totals, targets } = day;
  const target = targets.calories;
  const remaining = target !== null ? target - totals.calories : null;
  const unit = energyLabel(energyUnit);
  const macroTargets =
    targets.protein !== null && targets.carbs !== null && targets.fat !== null
      ? { protein: targets.protein, carbs: targets.carbs, fat: targets.fat }
      : null;

  return (
    <View style={styles.container}>
      <View style={styles.calories}>
        <View style={styles.figure}>
          <Text variant="title1" figure>
            {formatEnergy(totals.calories, energyUnit)}
          </Text>
          <Text variant="subheadline" tone="secondary" figure>
            {target !== null
              ? `/ ${formatEnergy(target, energyUnit)} ${unit}`
              : unit}
          </Text>
        </View>
        {remaining !== null ? (
          <Text
            variant="subheadline"
            figure
            tone={remaining < 0 ? "warning" : "secondary"}
          >
            {`${formatEnergy(Math.abs(remaining), energyUnit)} ${remaining < 0 ? "over" : "left"}`}
          </Text>
        ) : null}
      </View>
      <Meter
        progress={target ? totals.calories / target : 0}
        color={macroColors.calories}
        overflowColor={macroColors.overflow}
      />
      <MacroBars
        consumed={{
          protein: totals.protein,
          carbs: totals.carbs,
          fat: totals.fat,
        }}
        targets={macroTargets}
      />
    </View>
  );
}

const MACROS = [
  ["P", "protein"],
  ["C", "carbs"],
  ["F", "fat"],
] as const;

/**
 * The day's totals on one line, laid over the top of the log once the full
 * summary has scrolled away, so what is left stays in view while picking through the
 * log.
 */
export function DayTotalsBar({
  day,
  energyUnit,
}: {
  day: Pick<MacrosFoodLogDay, "totals" | "targets">;
  energyUnit: EnergyUnit;
}) {
  const { totals, targets } = day;
  const target = targets.calories;
  const remaining = target !== null ? target - totals.calories : null;
  return (
    <View style={styles.bar}>
      <View style={styles.barRow}>
        <Text variant="subheadline" weight="semibold" figure>
          {`${formatEnergy(totals.calories, energyUnit)} ${energyLabel(energyUnit)}`}
          {remaining !== null ? (
            <Text
              variant="subheadline"
              figure
              tone={remaining < 0 ? "warning" : "secondary"}
            >
              {`  ${formatEnergy(Math.abs(remaining), energyUnit)} ${remaining < 0 ? "over" : "left"}`}
            </Text>
          ) : null}
        </Text>
        <View style={styles.barMacros}>
          {MACROS.map(([letter, key]) => {
            const goal = targets[key];
            return (
              <Text key={key} variant="footnote" tone="secondary" figure>
                <Text
                  variant="footnote"
                  weight="semibold"
                  style={{ color: macroColors[key] }}
                >
                  {letter}
                </Text>{" "}
                {formatInteger(totals[key])}
                {goal !== null ? `/${formatInteger(goal)}` : ""}
              </Text>
            );
          })}
        </View>
      </View>
      <Meter
        progress={target ? totals.calories / target : 0}
        color={macroColors.calories}
        overflowColor={macroColors.overflow}
        height={2}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.xs,
    paddingHorizontal: gutter,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  barMacros: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  container: {
    gap: spacing.md,
  },
  calories: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
    flexWrap: "wrap",
  },
  figure: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
});
