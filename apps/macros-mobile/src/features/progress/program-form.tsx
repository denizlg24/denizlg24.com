import { PROTEIN_PROFILES } from "@repo/macros-core/wizard/calc";
import type {
  MacrosActiveGoal,
  MacrosDietPhase,
  MacrosGoalType,
  MacrosProgram,
  MacrosProgramMode,
} from "@repo/schemas/macros";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  type GoalInput,
  invalidateAfterGoalChange,
  updateActiveGoal,
} from "@/api/goals";
import {
  invalidateAfterTargetChange,
  type ProgramInput,
  saveProgram,
  useNutritionProgram,
  useStrategy,
} from "@/api/strategy";
import { useWeightOverview } from "@/api/weight";
import { errorMessage } from "@/lib/api";
import {
  type EnergyUnit,
  energyLabel,
  energyValue,
  formatDecimal,
  formatInteger,
  kgFromUnit,
  type WeightUnit,
  weightValue,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useSinglePress } from "@/lib/use-single-press";
import {
  InlineNotice,
  parseDecimal,
  Section,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { toolbarText } from "@/ui/toolbar";
import { MenuRow, Segmented, WeekdayToggles } from "./controls";
import {
  checkInWeekdayNames,
  dietPhaseOptions,
  goalTypeOptions,
  planWeekdayNames,
  programModeOptions,
} from "./labels";
import { ScrollScreen } from "./scroll-screen";
import { useUnits } from "./use-units";
import { currentWeightKg } from "./weight-progress";

const KJ_PER_KCAL = 4.184;
const KCAL_PER_KG = 7700;

type FatBasis = "percent" | "perKg";

interface Draft {
  mode: MacrosProgramMode;
  manualCalories: string;
  goalType: MacrosGoalType;
  rate: string;
  dietPhase: MacrosDietPhase;
  distributionProfile: string;
  protein: string;
  fatBasis: FatBasis;
  fat: string;
  highDays: number[];
  highDayAdjustment: string;
  checkInWeekday: number;
}

type DraftErrors = Partial<Record<keyof Draft, string>>;

/** Typed-in fields: their errors show while typing, the rest only after Save. */
const TEXT_FIELDS = [
  "manualCalories",
  "rate",
  "protein",
  "fat",
  "highDayAdjustment",
] as const satisfies ReadonlyArray<keyof Draft>;

const FAT_BASIS_OPTIONS = [
  { value: "percent", label: "% of calories" },
  { value: "perKg", label: "g per kg" },
] as const satisfies ReadonlyArray<{ value: FatBasis; label: string }>;

/** Monday first for reading, while the stored value keeps Sunday as 0. */
const CHECK_IN_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
  value: weekday,
  label: checkInWeekdayNames[weekday] ?? String(weekday),
}));

function phaseFor(goalType: MacrosGoalType): MacrosDietPhase {
  if (goalType === "lose") return "cut";
  if (goalType === "gain") return "bulk";
  return "maintain";
}

function trimNumber(value: number, digits: number): string {
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

function initialDraft(
  program: MacrosProgram | null,
  goal: MacrosActiveGoal | null,
  weightUnit: WeightUnit,
  energyUnit: EnergyUnit,
): Draft {
  const goalType = program?.goalType ?? goal?.goalType ?? "maintain";
  const balanced = PROTEIN_PROFILES[0];
  const fatPerKg = program?.fatGramsPerKg ?? null;
  return {
    mode: program?.mode ?? "coached",
    manualCalories:
      program?.manualCalorieTarget != null
        ? trimNumber(energyValue(program.manualCalorieTarget, energyUnit), 0)
        : "",
    goalType,
    rate:
      goal?.weeklyRateKg != null && goal.weeklyRateKg > 0
        ? trimNumber(weightValue(goal.weeklyRateKg, weightUnit), 2)
        : "",
    dietPhase: program?.dietPhase ?? phaseFor(goalType),
    distributionProfile:
      program?.distributionProfile ?? balanced?.value ?? "balanced",
    protein: trimNumber(
      program?.proteinGramsPerKg ?? balanced?.proteinPerKg ?? 1.8,
      2,
    ),
    fatBasis: fatPerKg != null ? "perKg" : "percent",
    fat:
      fatPerKg != null
        ? trimNumber(fatPerKg, 2)
        : trimNumber(
            program?.fatPercent ?? (balanced?.fatPct ?? 0.25) * 100,
            1,
          ),
    highDays: program?.calorieCycling.highDays ?? [],
    highDayAdjustment:
      program && program.calorieCycling.highDayAdjustment > 0
        ? trimNumber(
            energyValue(program.calorieCycling.highDayAdjustment, energyUnit),
            0,
          )
        : "",
    checkInWeekday: program?.checkInWeekday ?? 1,
  };
}

interface Parsed {
  program: ProgramInput;
  goal: GoalInput | null;
}

function kcalFrom(value: number, unit: EnergyUnit): number {
  return unit === "kj" ? value / KJ_PER_KCAL : value;
}

function parseDraft(
  draft: Draft,
  weightUnit: WeightUnit,
  energyUnit: EnergyUnit,
): {
  errors: DraftErrors;
  parsed: (Omit<Parsed, "goal"> & { rateKg: number | null }) | null;
} {
  const errors: DraftErrors = {};
  const energyRange = (min: number, max: number) =>
    `Between ${formatInteger(energyValue(min, energyUnit))} and ${formatInteger(energyValue(max, energyUnit))} ${energyLabel(energyUnit)}`;

  const protein = parseDecimal(draft.protein);
  if (protein == null || protein < 0.8 || protein > 4) {
    errors.protein = "Between 0.8 and 4 g per kg";
  }

  const fat = parseDecimal(draft.fat);
  if (draft.fatBasis === "percent" && (fat == null || fat < 10 || fat > 60)) {
    errors.fat = "Between 10% and 60%";
  }
  if (draft.fatBasis === "perKg" && (fat == null || fat < 0.3 || fat > 3)) {
    errors.fat = "Between 0.3 and 3 g per kg";
  }

  let manualKcal: number | null = null;
  if (draft.mode === "manual") {
    const value = parseDecimal(draft.manualCalories);
    manualKcal = value == null ? null : kcalFrom(value, energyUnit);
    if (manualKcal == null || manualKcal < 800 || manualKcal > 10000) {
      errors.manualCalories = energyRange(800, 10000);
    }
  }

  let adjustmentKcal = 0;
  if (draft.highDays.length > 0 && draft.highDayAdjustment.trim() !== "") {
    const value = parseDecimal(draft.highDayAdjustment);
    adjustmentKcal = value == null ? -1 : kcalFrom(value, energyUnit);
    if (adjustmentKcal < 0 || adjustmentKcal > 500) {
      errors.highDayAdjustment = energyRange(0, 500);
    }
  }

  let rateKg: number | null = null;
  if (draft.goalType !== "maintain") {
    const value = parseDecimal(draft.rate);
    rateKg = value == null ? null : kgFromUnit(value, weightUnit);
    if (rateKg == null || rateKg <= 0 || rateKg > 2) {
      errors.rate = `More than 0 and up to ${formatDecimal(weightValue(2, weightUnit))} ${weightUnit} a week`;
    }
  }

  if (Object.keys(errors).length > 0 || protein == null || fat == null) {
    return { errors, parsed: null };
  }

  return {
    errors,
    parsed: {
      rateKg,
      program: {
        goalType: draft.goalType,
        proteinGramsPerKg: protein,
        fatGramsPerKg: draft.fatBasis === "perKg" ? fat : null,
        fatPercent: draft.fatBasis === "percent" ? fat : null,
        distributionProfile: draft.distributionProfile,
        calorieCycling: {
          highDays: [...draft.highDays].sort((a, b) => a - b),
          highDayAdjustment: Math.round(adjustmentKcal),
        },
        checkInWeekday: draft.checkInWeekday,
        mode: draft.mode,
        dietPhase: draft.dietPhase,
        manualCalorieTarget: manualKcal == null ? null : Math.round(manualKcal),
      },
    },
  };
}

function sameNumber(
  a: number | null | undefined,
  b: number | null | undefined,
) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.005;
}

/** Everything the program owns apart from the goal type, which follows the goal. */
function preferencesUnchanged(
  program: MacrosProgram,
  next: ProgramInput,
): boolean {
  const cycling = next.calorieCycling ?? { highDays: [], highDayAdjustment: 0 };
  return (
    program.mode === next.mode &&
    program.dietPhase === next.dietPhase &&
    program.distributionProfile === next.distributionProfile &&
    program.checkInWeekday === next.checkInWeekday &&
    sameNumber(program.proteinGramsPerKg, next.proteinGramsPerKg) &&
    sameNumber(program.fatGramsPerKg, next.fatGramsPerKg) &&
    sameNumber(program.fatPercent, next.fatPercent) &&
    sameNumber(program.manualCalorieTarget, next.manualCalorieTarget) &&
    sameNumber(
      program.calorieCycling.highDayAdjustment,
      cycling.highDayAdjustment,
    ) &&
    program.calorieCycling.highDays.join() === (cycling.highDays ?? []).join()
  );
}

export function ProgramFormScreen() {
  const router = useRouter();
  const { weightUnit, energyUnit } = useUnits();
  const programQuery = useNutritionProgram();
  const strategy = useStrategy();
  const overview = useWeightOverview();

  if (programQuery.isPending || strategy.isPending) {
    return (
      <>
        <Stack.Toolbar placement="left">
          {toolbarText({
            onPress: () => router.back(),
            children: "Cancel",
          })}
        </Stack.Toolbar>
        <ActivityIndicator style={styles.spinner} />
      </>
    );
  }

  return (
    <ProgramForm
      program={programQuery.data?.program ?? null}
      goal={strategy.data?.goal ?? null}
      currentKg={currentWeightKg(overview.data)}
      weightUnit={weightUnit}
      energyUnit={energyUnit}
    />
  );
}

function ProgramForm({
  program,
  goal,
  currentKg,
  weightUnit,
  energyUnit,
}: {
  program: MacrosProgram | null;
  goal: MacrosActiveGoal | null;
  currentKg: number | null;
  weightUnit: WeightUnit;
  energyUnit: EnergyUnit;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const initial = useMemo(
    () => initialDraft(program, goal, weightUnit, energyUnit),
    [program, goal, weightUnit, energyUnit],
  );
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const { errors, parsed } = parseDraft(draft, weightUnit, energyUnit);
  const visibleErrors: DraftErrors = {};
  for (const key of TEXT_FIELDS) {
    if (errors[key] && (submitted || draft[key].trim() !== "")) {
      visibleErrors[key] = errors[key];
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: async (next: NonNullable<typeof parsed>) => {
      let goalId = program?.activeWeightGoalId ?? goal?.id ?? null;
      const goalChanged = goal
        ? goal.goalType !== next.program.goalType ||
          (next.program.goalType !== "maintain" &&
            !sameNumber(goal.weeklyRateKg, next.rateKg))
        : next.program.goalType !== "maintain";
      if (goalChanged) {
        const body: GoalInput =
          next.program.goalType === "maintain" || next.rateKg == null
            ? { goalType: next.program.goalType }
            : { goalType: next.program.goalType, weeklyRateKg: next.rateKg };
        const saved = await updateActiveGoal(body);
        goalId = saved.goal.id;
      }
      // A goal change re-issues targets and copies the goal type onto the
      // program by itself; saving an otherwise unchanged program on top would
      // leave a second, identical issue in the check-in history.
      const needsProgramSave =
        !program ||
        !preferencesUnchanged(program, next.program) ||
        (!goalChanged && program.goalType !== next.program.goalType);
      if (needsProgramSave) {
        await saveProgram({ ...next.program, activeWeightGoalId: goalId });
      }
    },
    onSuccess: async () => {
      haptics.success();
      await Promise.all([
        invalidateAfterTargetChange(queryClient),
        invalidateAfterGoalChange(queryClient),
      ]);
      router.back();
    },
    onError: () => {
      haptics.error();
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    },
  });

  const onSave = () => {
    setSubmitted(true);
    if (!parsed) {
      haptics.error();
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (!dirty && program) {
      router.back();
      return;
    }
    save.mutate(parsed);
  };

  const mode = programModeOptions.find((option) => option.value === draft.mode);
  const profileOptions = [
    ...PROTEIN_PROFILES.map((profile) => ({
      value: profile.value,
      label: profile.label,
    })),
    ...(PROTEIN_PROFILES.some(
      (profile) => profile.value === draft.distributionProfile,
    )
      ? []
      : [{ value: draft.distributionProfile, label: "Custom" }]),
  ];
  const rateHint = rateDescription(
    draft,
    parsed?.rateKg ?? null,
    currentKg,
    energyUnit,
  );
  const highDayCount = draft.highDays.length;
  const adjustment = parseDecimal(draft.highDayAdjustment) ?? 0;

  const saveOnce = useSinglePress(onSave);
  return (
    <>
      <Stack.Screen
        options={{
          title: program ? "Program" : "New program",
          gestureEnabled: !dirty,
        }}
      />
      <Stack.Toolbar placement="left">
        {toolbarText({
          onPress: () => router.back(),
          children: "Cancel",
        })}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {toolbarText({
          variant: "done",
          disabled: save.isPending,
          onPress: saveOnce,
          children: "Save",
        })}
      </Stack.Toolbar>
      <ScrollScreen ref={scrollRef}>
        <VStack>
          {save.error ? (
            <InlineNotice message={errorMessage(save.error)} />
          ) : null}
          {submitted && !parsed ? (
            <InlineNotice message="Check the highlighted fields." />
          ) : null}

          <Section title="Mode">
            <View style={styles.fields}>
              <Segmented
                options={programModeOptions}
                value={draft.mode}
                onChange={(value) => set("mode", value)}
              />
              <Text variant="footnote" tone="secondary">
                {mode?.description}
              </Text>
              {draft.mode === "manual" ? (
                <TextField
                  label="Daily calories"
                  keyboardType="decimal-pad"
                  suffix={energyLabel(energyUnit)}
                  value={draft.manualCalories}
                  onChangeText={(value) => set("manualCalories", value)}
                  error={visibleErrors.manualCalories}
                />
              ) : null}
            </View>
          </Section>

          <Section title="Goal">
            <View style={styles.fields}>
              <Segmented
                options={goalTypeOptions}
                value={draft.goalType}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    goalType: value,
                    dietPhase:
                      current.dietPhase === "diet_break"
                        ? current.dietPhase
                        : phaseFor(value),
                  }))
                }
              />
              {draft.goalType !== "maintain" ? (
                <TextField
                  label={
                    draft.goalType === "lose"
                      ? "Lose per week"
                      : "Gain per week"
                  }
                  keyboardType="decimal-pad"
                  suffix={weightUnit}
                  placeholder={weightUnit === "lb" ? "1" : "0.5"}
                  value={draft.rate}
                  onChangeText={(value) => set("rate", value)}
                  error={visibleErrors.rate}
                  hint={rateHint}
                />
              ) : null}
            </View>
            <MenuRow
              title="Phase"
              value={draft.dietPhase}
              options={dietPhaseOptions}
              onChange={(value) => set("dietPhase", value)}
              separator={false}
            />
          </Section>

          <Section title="Macros">
            <MenuRow
              title="Split"
              subtitle="Sets protein and fat to a starting point"
              value={draft.distributionProfile}
              options={profileOptions}
              onChange={(value) => {
                const profile = PROTEIN_PROFILES.find(
                  (option) => option.value === value,
                );
                setDraft((current) => ({
                  ...current,
                  distributionProfile: value,
                  ...(profile
                    ? {
                        protein: trimNumber(profile.proteinPerKg, 2),
                        fatBasis: "percent" as const,
                        fat: trimNumber(profile.fatPct * 100, 1),
                      }
                    : {}),
                }));
              }}
            />
            <View style={styles.fields}>
              <TextField
                label="Protein"
                keyboardType="decimal-pad"
                suffix="g per kg"
                value={draft.protein}
                onChangeText={(value) => set("protein", value)}
                error={visibleErrors.protein}
                hint="Per kg of body weight. 1.6–2.2 suits most people."
              />
              <Segmented
                options={FAT_BASIS_OPTIONS}
                value={draft.fatBasis}
                onChange={(value) => set("fatBasis", value)}
              />
              <TextField
                label="Fat"
                keyboardType="decimal-pad"
                suffix={draft.fatBasis === "percent" ? "%" : "g per kg"}
                value={draft.fat}
                onChangeText={(value) => set("fat", value)}
                error={visibleErrors.fat}
                hint="Carbs fill whatever calories are left."
              />
            </View>
          </Section>

          <Section
            title="High days"
            footer="More calories on the days you train. The other days give the same amount back, so the week adds up to your target."
          >
            <View style={styles.fields}>
              <WeekdayToggles
                labels={planWeekdayNames}
                selected={draft.highDays}
                onToggle={(weekday) =>
                  setDraft((current) => ({
                    ...current,
                    highDays: current.highDays.includes(weekday)
                      ? current.highDays.filter((day) => day !== weekday)
                      : [...current.highDays, weekday],
                  }))
                }
              />
              {highDayCount > 0 ? (
                <TextField
                  label="Extra on high days"
                  keyboardType="decimal-pad"
                  suffix={energyLabel(energyUnit)}
                  placeholder="0"
                  value={draft.highDayAdjustment}
                  onChangeText={(value) => set("highDayAdjustment", value)}
                  error={visibleErrors.highDayAdjustment}
                  hint={
                    highDayCount < 7 && adjustment > 0
                      ? `Other days: −${formatInteger((adjustment * highDayCount) / (7 - highDayCount))} ${energyLabel(energyUnit)}`
                      : undefined
                  }
                />
              ) : null}
            </View>
          </Section>

          <Section
            title="Check-in"
            footer="Each week on this day, Macros re-estimates your expenditure and sets the coming week’s targets."
          >
            <MenuRow
              title="Check-in day"
              value={draft.checkInWeekday}
              options={CHECK_IN_OPTIONS}
              onChange={(value) => set("checkInWeekday", value)}
              separator={false}
            />
          </Section>
        </VStack>
      </ScrollScreen>
    </>
  );
}

function rateDescription(
  draft: Draft,
  rateKg: number | null,
  currentKg: number | null,
  energyUnit: EnergyUnit,
): string | undefined {
  if (draft.goalType === "maintain" || rateKg == null || rateKg <= 0)
    return undefined;
  const dailyKcal = (rateKg * KCAL_PER_KG) / 7;
  const direction = draft.goalType === "lose" ? "below" : "above";
  const share =
    currentKg != null && currentKg > 0
      ? `${formatDecimal((rateKg / currentKg) * 100)}% of body weight a week, `
      : "";
  return `${share}about ${formatInteger(energyValue(dailyKcal, energyUnit))} ${energyLabel(energyUnit)} a day ${direction} what you burn.`;
}

const styles = StyleSheet.create({
  spinner: {
    paddingVertical: spacing.xxxl,
  },
  fields: {
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
