import {
  ACTIVITY_LEVELS,
  PROTEIN_PROFILES,
  WEEKDAY_FULL,
} from "@repo/macros-core/wizard/calc";
import { format, parseISO } from "date-fns";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { isAlreadyCompleted, useCompleteRegistration } from "@/api/onboarding";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone } from "@/lib/day";
import {
  energyLabel,
  formatDecimal,
  formatInteger,
  weightValue,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { parseDecimal } from "@/lib/numbers";
import { macroColors, Row, Section, Stat, spacing, Text, VStack } from "@/ui";
import { useOnboardingDraft } from "../draft-context";
import {
  ageOf,
  averageOfDays,
  buildRegistrationBody,
  GOAL_CHOICES,
  hasErrors,
  heightCmOf,
  isDirectionalGoal,
  planDays,
  SEX_CHOICES,
  type StepKey,
  stepHref,
  toDisplayEnergy,
  validateStep,
  weeklyRateKgOf,
} from "../model";
import { StepScaffold } from "../step-scaffold";

const pace = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function labelFor<T extends string>(
  choices: readonly { value: T; label: string }[],
  value: T | null,
): string {
  return choices.find((choice) => choice.value === value)?.label ?? "Not set";
}

export function SummaryStep() {
  const router = useRouter();
  const { draft } = useOnboardingDraft();
  const complete = useCompleteRegistration();
  const [answerError, setAnswerError] = useState<string | null>(null);

  const unit = energyLabel(draft.energyUnit);
  const display = (kcal: number) =>
    formatInteger(toDisplayEnergy(kcal, draft.energyUnit));
  const days = planDays(draft) ?? [];
  const average = averageOfDays(days);
  const calories = days.map((day) => day.calorieTarget);
  const lowest = Math.min(...calories);
  const highest = Math.max(...calories);
  const varies = days.length > 0 && lowest !== highest;

  const directional = isDirectionalGoal(draft.goalType);
  const current = parseDecimal(draft.currentWeight);
  const target = parseDecimal(draft.targetWeight);
  const rateKg = weeklyRateKgOf(draft);
  const heightCm = heightCmOf(draft);
  const age = ageOf(draft);
  const weightUnit = draft.weightUnit;

  const edit = (step: StepKey) => () => router.dismissTo(stepHref(step));

  function submit() {
    setAnswerError(null);
    const body = hasErrors(validateStep("summary", draft))
      ? null
      : buildRegistrationBody(draft, deviceTimeZone());
    if (!body) {
      haptics.error();
      setAnswerError("Some answers need another look. Tap a row to change it.");
      return;
    }
    complete.mutate(body, {
      onSuccess: () => haptics.success(),
      onError: (error) => {
        if (!isAlreadyCompleted(error)) haptics.error();
      },
    });
  }

  const serverError =
    complete.error && !isAlreadyCompleted(complete.error)
      ? errorMessage(complete.error)
      : null;

  const heightLabel =
    heightCm === undefined
      ? "Not set"
      : weightUnit === "kg"
        ? `${formatDecimal(heightCm)} cm`
        : `${draft.heightFt || "0"} ft ${draft.heightIn || "0"} in`;

  return (
    <StepScaffold
      step="summary"
      intro="Your starting targets. Tap any answer to change it before you begin."
      continueLabel="Start tracking"
      busy={complete.isPending}
      error={answerError ?? serverError}
      onContinue={submit}
    >
      <VStack gap={spacing.lg}>
        <Stat
          label={varies ? "Daily energy · average" : "Daily energy"}
          value={display(average.calories)}
          unit={unit}
          detail={
            varies
              ? `${display(lowest)}–${display(highest)} ${unit} across the week`
              : undefined
          }
          size="hero"
        />
        <View style={styles.macros}>
          <MacroFigure
            label="Protein"
            grams={average.protein}
            color={macroColors.protein}
          />
          <MacroFigure
            label="Carbs"
            grams={average.carbs}
            color={macroColors.carbs}
          />
          <MacroFigure
            label="Fat"
            grams={average.fat}
            color={macroColors.fat}
          />
        </View>
      </VStack>

      {varies ? (
        <Section title="Week">
          {days.map((day, index) => (
            <Row
              key={day.weekday}
              title={WEEKDAY_FULL[day.weekday] ?? "Day"}
              value={`${display(day.calorieTarget)} ${unit}`}
              separator={index < days.length - 1}
              chevron
              onPress={edit("week")}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Goal">
        <Row
          title="Goal"
          value={labelFor(GOAL_CHOICES, draft.goalType)}
          chevron
          onPress={edit("goal")}
        />
        {directional && target !== null ? (
          <Row
            title="Target weight"
            value={`${formatDecimal(target)} ${weightUnit}`}
            chevron
            onPress={edit("goal")}
          />
        ) : null}
        {directional && draft.goalDate ? (
          <Row
            title="Goal date"
            value={format(parseISO(draft.goalDate), "d MMM yyyy")}
            chevron
            onPress={edit("goal")}
          />
        ) : null}
        {directional ? (
          <Row
            title="Pace"
            value={
              rateKg === undefined
                ? "Default"
                : `${pace.format(weightValue(rateKg, weightUnit))} ${weightUnit} a week`
            }
            chevron
            onPress={edit("goal")}
          />
        ) : null}
        <Row
          title="Starting weight"
          value={
            current === null
              ? "Not set"
              : `${formatDecimal(current)} ${weightUnit}`
          }
          separator={false}
          chevron
          onPress={edit("weight")}
        />
      </Section>

      <Section title="You">
        <Row
          title="Units"
          value={`${weightUnit} · ${unit}`}
          chevron
          onPress={edit("units")}
        />
        <Row
          title="Sex"
          value={labelFor(SEX_CHOICES, draft.sex)}
          chevron
          onPress={edit("about")}
        />
        <Row
          title="Age"
          value={age === undefined ? "Not set" : `${age}`}
          chevron
          onPress={edit("about")}
        />
        <Row
          title="Height"
          value={heightLabel}
          chevron
          onPress={edit("about")}
        />
        <Row
          title="Activity"
          value={labelFor(ACTIVITY_LEVELS, draft.activityLevel)}
          chevron
          onPress={edit("activity")}
        />
        <Row
          title="Macro profile"
          value={labelFor(PROTEIN_PROFILES, draft.proteinProfile)}
          separator={false}
          chevron
          onPress={edit("macros")}
        />
      </Section>
    </StepScaffold>
  );
}

function MacroFigure({
  label,
  grams,
  color,
}: {
  label: string;
  grams: number;
  color: string;
}) {
  return (
    <View style={styles.macro}>
      <View style={styles.macroLabel}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text variant="caption1" tone="secondary" eyebrow>
          {label}
        </Text>
      </View>
      <Text variant="title2" figure>
        {formatInteger(grams)}
        <Text variant="footnote" tone="secondary">
          {" "}
          g
        </Text>
      </Text>
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
    gap: spacing.xxs,
  },
  macroLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
