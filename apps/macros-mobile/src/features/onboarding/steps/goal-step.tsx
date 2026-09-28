import { addWeeks, addYears, format, parseISO, startOfDay } from "date-fns";
import { useMemo } from "react";
import { formatDecimal, weightValue } from "@/lib/format";
import { parseDecimal } from "@/lib/numbers";
import { Section, Stat, spacing, Text, TextField, VStack } from "@/ui";
import { ChoiceList } from "../choice-list";
import { DateRow } from "../date-row";
import {
  earliestGoalDate,
  GOAL_CHOICES,
  isDirectionalGoal,
  weeklyRateKgOf,
} from "../model";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

const pace = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function GoalStep() {
  const { draft, update, errors, advance, clearError } = useStep("goal");
  const directional = isDirectionalGoal(draft.goalType);
  const rateKg = weeklyRateKgOf(draft);
  const target = parseDecimal(draft.targetWeight);
  const bounds = useMemo(() => {
    const today = startOfDay(new Date());
    return {
      earliest: earliestGoalDate(today),
      typical: addWeeks(today, 12),
      latest: addYears(today, 5),
    };
  }, []);

  return (
    <StepScaffold
      step="goal"
      intro="Pick a direction. A target and a date are optional; together they set your pace."
      onContinue={() => advance()}
    >
      <Section title="Goal">
        <ChoiceList
          choices={GOAL_CHOICES}
          value={draft.goalType}
          onChange={(goalType) => {
            update({ goalType });
            clearError("goalType");
          }}
        />
        {errors.goalType ? (
          <Text variant="footnote" tone="destructive">
            {errors.goalType}
          </Text>
        ) : null}
      </Section>

      {directional ? (
        <Section title="Target">
          <VStack gap={spacing.sm}>
            <TextField
              label="Target weight"
              value={draft.targetWeight}
              onChangeText={(targetWeight) => {
                update({ targetWeight });
                clearError("targetWeight");
                clearError("goalDate");
              }}
              error={errors.targetWeight}
              placeholder={draft.weightUnit === "kg" ? "68" : "150"}
              suffix={draft.weightUnit}
              keyboardType="decimal-pad"
            />
            <DateRow
              title="Goal date"
              value={draft.goalDate}
              defaultDate={bounds.typical}
              minimumDate={bounds.earliest}
              maximumDate={bounds.latest}
              error={errors.goalDate}
              onChange={(goalDate) => {
                update({ goalDate });
                clearError("goalDate");
              }}
            />
          </VStack>
        </Section>
      ) : null}

      {directional &&
      rateKg !== undefined &&
      target !== null &&
      draft.goalDate ? (
        <Stat
          label="Projected pace"
          value={pace.format(weightValue(rateKg, draft.weightUnit))}
          unit={`${draft.weightUnit} a week`}
          detail={`Reaching ${formatDecimal(target)} ${draft.weightUnit} by ${format(parseISO(draft.goalDate), "d MMM yyyy")}`}
          size="large"
        />
      ) : directional ? (
        <Text variant="footnote" tone="secondary">
          Without both a target and a date, your plan uses a steady default
          pace.
        </Text>
      ) : null}
    </StepScaffold>
  );
}
