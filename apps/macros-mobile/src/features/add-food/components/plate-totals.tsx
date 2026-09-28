import { StyleSheet, View } from "react-native";
import {
  type EnergyUnit,
  energyLabel,
  formatEnergy,
  formatInteger,
} from "@/lib/format";
import { gutter, Meter, macroColors, spacing, Text } from "@/ui";
import type { MacroTargets } from "../nutrition";
import type { MacroSnapshot } from "../serving";

/** What the plate adds up to, each figure against the day's target. */
export function PlateTotals({
  totals,
  targets,
  energyUnit,
}: {
  totals: MacroSnapshot;
  targets: MacroTargets | null;
  energyUnit: EnergyUnit;
}) {
  const columns = [
    {
      key: "calories",
      value: formatEnergy(totals.calories, energyUnit),
      unit: energyLabel(energyUnit),
      progress: ratio(totals.calories, targets?.calories),
      target:
        targets?.calories != null
          ? formatEnergy(targets.calories, energyUnit)
          : null,
      color: macroColors.calories,
    },
    {
      key: "protein",
      value: formatInteger(totals.protein),
      unit: "P",
      progress: ratio(totals.protein, targets?.protein),
      target: targets?.protein != null ? formatInteger(targets.protein) : null,
      color: macroColors.protein,
    },
    {
      key: "fat",
      value: formatInteger(totals.fat),
      unit: "F",
      progress: ratio(totals.fat, targets?.fat),
      target: targets?.fat != null ? formatInteger(targets.fat) : null,
      color: macroColors.fat,
    },
    {
      key: "carbs",
      value: formatInteger(totals.carbs),
      unit: "C",
      progress: ratio(totals.carbs, targets?.carbs),
      target: targets?.carbs != null ? formatInteger(targets.carbs) : null,
      color: macroColors.carbs,
    },
  ];

  return (
    <View style={styles.grid}>
      {columns.map((column) => (
        <View
          key={column.key}
          style={styles.column}
          accessible
          accessibilityLabel={
            column.target
              ? `${column.value} ${column.unit} of ${column.target}`
              : `${column.value} ${column.unit}`
          }
        >
          <Text variant="title2" figure numberOfLines={1} adjustsFontSizeToFit>
            {column.value}
          </Text>
          <Meter
            progress={column.progress}
            color={column.color}
            overflowColor={macroColors.overflow}
            height={4}
          />
          <Text variant="footnote" tone="secondary" figure numberOfLines={1}>
            {column.target ? `${column.unit} of ${column.target}` : column.unit}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ratio(value: number, target: number | null | undefined): number {
  return target && target > 0 ? value / target : 0;
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: gutter,
    paddingVertical: spacing.lg,
  },
  column: {
    flex: 1,
    gap: spacing.sm,
  },
});
