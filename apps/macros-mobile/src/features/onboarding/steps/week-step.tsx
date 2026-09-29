import { WEEKDAY_FULL } from "@repo/macros-core/wizard/calc";
import { StyleSheet, View } from "react-native";
import { energyLabel, formatInteger } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { Row, Section, Stat, spacing, VStack } from "@/ui";
import { Stepper } from "@/ui/stepper";
import {
  caloriesKcalOf,
  dayAdjustmentLimit,
  planDays,
  stepDayDelta,
  toDisplayEnergy,
  WEEKDAY_STEP_KCAL,
} from "../model";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

function signed(value: number): string {
  return `${value > 0 ? "+" : "−"}${formatInteger(Math.abs(value))}`;
}

export function WeekStep() {
  const { draft, update, advance } = useStep("week");
  const unit = energyLabel(draft.energyUnit);
  const baseKcal = caloriesKcalOf(draft) ?? 0;
  const limit = dayAdjustmentLimit(baseKcal);
  const days = planDays(draft) ?? [];
  const display = (kcal: number) =>
    formatInteger(toDisplayEnergy(kcal, draft.energyUnit));
  const weekKcal = days.reduce((sum, day) => sum + day.calorieTarget, 0);
  const adjusted = draft.dayDeltasKcal.some((delta) => delta !== 0);

  return (
    <StepScaffold
      step="week"
      intro="Eat more on training or social days and less on others. Protein, carbs and fat scale with each day."
      onContinue={() => advance()}
    >
      <View style={styles.totals}>
        <Stat
          label="Weekly total"
          value={display(weekKcal)}
          unit={unit}
          size="large"
        />
        <Stat
          label="Daily average"
          value={display(days.length > 0 ? weekKcal / days.length : 0)}
          unit={unit}
          size="large"
          align="right"
        />
      </View>

      <Section
        title="Days"
        action={
          adjusted
            ? {
                label: "Reset",
                onPress: () => {
                  haptics.selection();
                  update({ dayDeltasKcal: draft.dayDeltasKcal.map(() => 0) });
                },
              }
            : undefined
        }
        footer={`Each step is ${display(WEEKDAY_STEP_KCAL)} ${unit}, up to ${display(limit)} ${unit} either way.`}
      >
        <VStack gap={0}>
          {WEEKDAY_FULL.map((weekday, index) => {
            const delta = draft.dayDeltasKcal[index] ?? 0;
            const day = days[index];
            return (
              <Row
                key={weekday}
                title={weekday}
                subtitle={
                  delta === 0
                    ? "Base"
                    : `${signed(Math.round(toDisplayEnergy(delta, draft.energyUnit)))} ${unit}`
                }
                value={day ? display(day.calorieTarget) : undefined}
                valueTone="primary"
                separator={index < WEEKDAY_FULL.length - 1}
                trailing={
                  <Stepper
                    label={`Adjust ${weekday}`}
                    value={delta}
                    step={WEEKDAY_STEP_KCAL}
                    min={-limit}
                    max={limit}
                    hideLabel
                    onValueChange={(value) => {
                      if (value === delta) return;
                      haptics.selection();
                      update((current) =>
                        stepDayDelta(current, index, value > delta ? 1 : -1),
                      );
                    }}
                  />
                }
              />
            );
          })}
        </VStack>
      </Section>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  totals: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
});
