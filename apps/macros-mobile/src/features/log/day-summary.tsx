import type { MacrosFoodLogDay } from "@repo/schemas/macros";
import { StyleSheet, View } from "react-native";
import { MacroBars } from "@/components/macro-bars";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import { Meter, macroColors, spacing, Text } from "@/ui";

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

const styles = StyleSheet.create({
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
