import { adjustSplit, type MacroSplit } from "@repo/macros-core/wizard/calc";
import { StyleSheet, View } from "react-native";
import { energyLabel, formatDecimal, formatInteger } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  macroColors,
  Section,
  spacing,
  Text,
  TextField,
  typeScale,
  VStack,
} from "@/ui";
import { Slider } from "@/ui/slider";
import { caloriesKcalOf, macroGrams, toKg } from "../model";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

const MACROS = [
  {
    key: "protein",
    label: "Protein",
    kcalPerGram: 4,
    color: macroColors.protein,
  },
  { key: "carbs", label: "Carbs", kcalPerGram: 4, color: macroColors.carbs },
  { key: "fat", label: "Fat", kcalPerGram: 9, color: macroColors.fat },
] as const;

function sameSplit(a: MacroSplit, b: MacroSplit) {
  return a.protein === b.protein && a.carbs === b.carbs && a.fat === b.fat;
}

export function TargetsStep() {
  const { draft, update, errors, advance, clearError } = useStep("targets");
  const unit = energyLabel(draft.energyUnit);
  const kcal = caloriesKcalOf(draft) ?? 0;
  const weightKg = toKg(draft.currentWeight, draft.weightUnit);
  const suggested = draft.suggested;
  const edited =
    suggested !== null &&
    (suggested.calories !== draft.calories ||
      !sameSplit(suggested.split, draft.split));

  return (
    <StepScaffold
      step="targets"
      intro="Calculated from your answers. Adjust anything that doesn’t look right."
      onContinue={() => advance()}
    >
      <TextField
        label="Daily energy"
        value={draft.calories}
        onChangeText={(calories) => {
          update({ calories });
          clearError("calories");
        }}
        error={errors.calories}
        hint={
          suggested
            ? `Suggested: ${formatInteger(Number(suggested.calories))} ${unit}`
            : undefined
        }
        placeholder={draft.energyUnit === "kcal" ? "2000" : "8368"}
        suffix={unit}
        keyboardType="number-pad"
        style={styles.figure}
      />

      <Section
        title="Macros"
        action={
          edited && suggested
            ? {
                label: "Reset",
                onPress: () => {
                  update({
                    calories: suggested.calories,
                    split: suggested.split,
                  });
                  clearError("calories");
                },
              }
            : undefined
        }
        footer="Protein, carbs and fat always add up to 100%."
      >
        <VStack gap={spacing.xl}>
          {MACROS.map((macro) => {
            const percent = draft.split[macro.key];
            const grams = macroGrams(kcal, percent, macro.kcalPerGram);
            return (
              <View key={macro.key} style={styles.macro}>
                <View style={styles.macroHeader}>
                  <View
                    style={[styles.dot, { backgroundColor: macro.color }]}
                  />
                  <Text
                    variant="body"
                    weight="medium"
                    style={styles.macroLabel}
                  >
                    {macro.label}
                  </Text>
                  <Text variant="body" figure>
                    {kcal > 0 ? `${formatInteger(grams)} g · ` : ""}
                    <Text variant="body" figure tone="secondary">
                      {percent}%
                    </Text>
                  </Text>
                </View>
                <Slider
                  value={percent}
                  minimumValue={10}
                  maximumValue={70}
                  step={1}
                  minimumTrackTintColor={macro.color}
                  onValueChange={(value) => {
                    const next = Math.round(value);
                    if (next === draft.split[macro.key]) return;
                    haptics.selection();
                    update((current) => ({
                      ...current,
                      split: adjustSplit(macro.key, next, current.split),
                    }));
                  }}
                />
                {macro.key === "protein" && weightKg && kcal > 0 ? (
                  <Text variant="footnote" tone="secondary" figure>
                    {formatDecimal(grams / weightKg)} g per kg of body weight
                  </Text>
                ) : null}
              </View>
            );
          })}
        </VStack>
      </Section>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  figure: {
    ...typeScale.title1,
    fontWeight: "600",
  },
  macro: {
    gap: spacing.sm,
  },
  macroHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  macroLabel: {
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
