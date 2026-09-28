import { MenuView } from "@expo/ui/community/menu";
import type {
  MacrosCaloriePreference,
  MacrosDailyMacros,
  MacrosNutritionTargets,
} from "@repo/schemas/macros";
import { Pressable, StyleSheet, View } from "react-native";
import { CalorieRing } from "@/components/calorie-ring";
import { MacroBars } from "@/components/macro-bars";
import {
  type EnergyUnit,
  energyLabel,
  formatEnergy,
  formatInteger,
} from "@/lib/format";
import { spacing, Text } from "@/ui";

export interface NutritionSummaryProps {
  consumed: MacrosDailyMacros;
  targets: MacrosNutritionTargets;
  mode: MacrosCaloriePreference;
  energyUnit: EnergyUnit;
  onModeChange: (mode: MacrosCaloriePreference) => void;
  onOpenLog: () => void;
}

function Flank({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View style={styles.flank}>
      <Text variant="caption1" tone="secondary" eyebrow numberOfLines={1}>
        {label}
      </Text>
      <Text variant="title3" figure numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption2" tone="tertiary">
        {unit}
      </Text>
    </View>
  );
}

const MODE_LABEL: Record<MacrosCaloriePreference, string> = {
  remaining: "Remaining",
  consumed: "Consumed",
};

export function NutritionSummary({
  consumed,
  targets,
  mode,
  energyUnit,
  onModeChange,
  onOpenLog,
}: NutritionSummaryProps) {
  const unit = energyLabel(energyUnit);
  const format = (kcal: number) => formatEnergy(kcal, energyUnit);
  const target = targets.calories;
  const remaining = target !== null ? target - consumed.calories : null;
  const otherMode: MacrosCaloriePreference =
    mode === "remaining" ? "consumed" : "remaining";

  const leading =
    mode === "remaining"
      ? { label: "Eaten", value: format(consumed.calories) }
      : {
          label: remaining !== null && remaining < 0 ? "Over" : "Left",
          value: remaining !== null ? format(Math.abs(remaining)) : "—",
        };

  const ringLabel =
    mode === "remaining" && remaining !== null
      ? `${format(Math.abs(remaining))} ${unit} ${remaining >= 0 ? "left" : "over"} of ${format(target ?? 0)}`
      : target !== null
        ? `${format(consumed.calories)} of ${format(target)} ${unit} eaten`
        : `${format(consumed.calories)} ${unit} eaten`;

  const macroTargets =
    targets.protein !== null && targets.carbs !== null && targets.fat !== null
      ? { protein: targets.protein, carbs: targets.carbs, fat: targets.fat }
      : null;

  const macroLabel = (["protein", "carbs", "fat"] as const)
    .map((key) => {
      const goal = macroTargets?.[key];
      const value = formatInteger(consumed[key]);
      return goal !== undefined
        ? `${key} ${value} of ${formatInteger(goal)} grams`
        : `${key} ${value} grams`;
    })
    .join(", ");

  return (
    <View style={styles.container}>
      <View style={styles.ringRow}>
        <Flank label={leading.label} value={leading.value} unit={unit} />
        <MenuView
          shouldOpenOnLongPress
          actions={[
            {
              id: "ring",
              title: "Ring shows",
              displayInline: true,
              subactions: (["remaining", "consumed"] as const).map((value) => ({
                id: value,
                title: MODE_LABEL[value],
                state: value === mode ? "on" : "off",
              })),
            },
            { id: "log", title: "Open food log", image: "list.bullet" },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "log") onOpenLog();
            else if (nativeEvent.event === "remaining")
              onModeChange("remaining");
            else if (nativeEvent.event === "consumed") onModeChange("consumed");
          }}
        >
          <Pressable
            onPress={() => onModeChange(otherMode)}
            // Without a long-press handler, releasing after the context menu
            // opens would also count as a tap and flip the ring.
            onLongPress={() => undefined}
            accessibilityRole="button"
            accessibilityLabel={ringLabel}
            accessibilityHint={`Shows ${MODE_LABEL[otherMode].toLowerCase()} instead`}
          >
            <CalorieRing
              consumed={consumed.calories}
              target={target}
              mode={mode}
              unitLabel={unit}
              formatValue={format}
              size={168}
            />
          </Pressable>
        </MenuView>
        <Flank
          label="Target"
          value={target !== null ? format(target) : "—"}
          unit={unit}
        />
      </View>

      <Pressable
        onPress={onOpenLog}
        accessibilityRole="button"
        accessibilityLabel={macroLabel}
        accessibilityHint="Opens the food log"
        style={({ pressed }) => pressed && styles.pressed}
      >
        <MacroBars consumed={consumed} targets={macroTargets} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
    paddingVertical: spacing.sm,
  },
  ringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  flank: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.6,
  },
});
