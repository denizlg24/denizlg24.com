import { caloriesFromMacros } from "@repo/macros-core/plans/check-in";
import { calculateDynamicTargets } from "@repo/macros-core/plans/target-engine";
import type {
  MacrosActiveGoal,
  MacrosCheckInResponse,
  MacrosProgram,
} from "@repo/schemas/macros";
import { Stack, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import {
  useCheckIn,
  useNutritionProgram,
  useStrategy,
  useSubmitCheckIn,
} from "@/api/strategy";
import { useWeightOverview } from "@/api/weight";
import { errorMessage } from "@/lib/api";
import {
  type EnergyUnit,
  energyLabel,
  energyValue,
  formatInteger,
  formatWeight,
  formatWeightDelta,
  type WeightUnit,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useSinglePress } from "@/lib/use-single-press";
import {
  InlineNotice,
  parseDecimal,
  Row,
  Section,
  Stat,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { toolbarText } from "@/ui/toolbar";
import {
  confidenceRadius,
  formatEnergyWithUnit,
  formatSignedEnergy,
} from "./labels";
import {
  goalBody,
  goalChanged,
  initialDraft,
  parseDraft,
  visibleDraftErrors,
} from "./program-draft";
import { ProgramFields } from "./program-fields";
import { ScrollScreen } from "./scroll-screen";
import { MacroTargets } from "./target-figures";
import { useUnits } from "./use-units";
import { currentWeightKg } from "./weight-progress";

interface CustomDraft {
  on: boolean;
  protein: string;
  carbs: string;
  fat: string;
}

type Grams = { proteinGrams: number; carbsGrams: number; fatGrams: number };

function parseCustom(custom: CustomDraft): {
  grams: Grams | null;
  error: string | null;
} {
  if (!custom.on) return { grams: null, error: null };
  const proteinGrams = parseDecimal(custom.protein);
  const carbsGrams = parseDecimal(custom.carbs);
  const fatGrams = parseDecimal(custom.fat);
  if (
    proteinGrams == null ||
    carbsGrams == null ||
    fatGrams == null ||
    proteinGrams < 0 ||
    carbsGrams < 0 ||
    fatGrams < 0
  ) {
    return { grams: null, error: "Enter grams for all three macros." };
  }
  const grams = { proteinGrams, carbsGrams, fatGrams };
  if (caloriesFromMacros(grams) < 800) {
    return { grams: null, error: "These add up to less than 800 kcal." };
  }
  return { grams, error: null };
}

function clampNote(clamp: string, unit: EnergyUnit): string | null {
  switch (clamp) {
    case "calorie_floor":
      return "Held at the lowest intake the program allows.";
    case "surplus_ceiling":
      return "Capped at 20% above what you burn.";
    case "weekly_change":
      return `Limited to a ${formatEnergyWithUnit(150, unit)} change a week.`;
    case "macro_floor":
      return "Protein and fat minimums leave no room for carbs.";
    default:
      return null;
  }
}

export function CheckInScreen() {
  const router = useRouter();
  const { weightUnit, energyUnit } = useUnits();
  const checkIn = useCheckIn();
  const programQuery = useNutritionProgram();
  const strategy = useStrategy();
  const overview = useWeightOverview();
  const program = programQuery.data?.program ?? null;

  if (!checkIn.data || !program || strategy.isPending) {
    const error = checkIn.error ?? programQuery.error ?? strategy.error;
    return (
      <>
        <Stack.Toolbar placement="left">
          {toolbarText({ onPress: () => router.back(), children: "Cancel" })}
        </Stack.Toolbar>
        {error ? (
          <View style={styles.notice}>
            <InlineNotice
              message={errorMessage(error)}
              action={{
                label: "Retry",
                onPress: () => {
                  void checkIn.refetch();
                  void programQuery.refetch();
                },
              }}
            />
          </View>
        ) : (
          <ActivityIndicator style={styles.spinner} />
        )}
      </>
    );
  }

  return (
    <CheckInForm
      data={checkIn.data}
      program={program}
      goal={strategy.data?.goal ?? null}
      currentKg={currentWeightKg(overview.data)}
      weightUnit={weightUnit}
      energyUnit={energyUnit}
    />
  );
}

function CheckInForm({
  data,
  program,
  goal,
  currentKg,
  weightUnit,
  energyUnit,
}: {
  data: MacrosCheckInResponse;
  program: MacrosProgram;
  goal: MacrosActiveGoal | null;
  currentKg: number | null;
  weightUnit: WeightUnit;
  energyUnit: EnergyUnit;
}) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const submit = useSubmitCheckIn();
  const initial = useMemo(
    () => initialDraft(program, goal, weightUnit, energyUnit),
    [program, goal, weightUnit, energyUnit],
  );
  const [draft, setDraft] = useState(initial);
  const [custom, setCustom] = useState<CustomDraft>({
    on: false,
    protein: "",
    carbs: "",
    fat: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const dirty = custom.on || JSON.stringify(draft) !== JSON.stringify(initial);

  const { errors, parsed } = parseDraft(draft, weightUnit, energyUnit);
  const visibleErrors = visibleDraftErrors(draft, errors, submitted);
  const customParsed = parseCustom(custom);

  const engineTarget = parsed
    ? calculateDynamicTargets({
        ...data.engine,
        goalType: parsed.program.goalType,
        goalRateKgPerWeek: parsed.rateKg ?? 0,
        proteinGramsPerKg: parsed.program.proteinGramsPerKg,
        fatGramsPerKg: parsed.program.fatGramsPerKg,
        fatPercent: parsed.program.fatPercent,
        manualCalories: parsed.program.manualCalorieTarget,
      })
    : data.proposal;
  const shown = customParsed.grams
    ? {
        ...customParsed.grams,
        calories: caloriesFromMacros(customParsed.grams),
      }
    : engineTarget;
  const change =
    data.current != null ? shown.calories - data.current.calorieTarget : null;
  const notes = customParsed.grams
    ? []
    : engineTarget.clamps
        .map((clamp) => clampNote(clamp, energyUnit))
        .filter((note): note is string => note != null);

  const toggleCustom = (on: boolean) => {
    haptics.selection();
    setCustom((current) =>
      on && current.protein === ""
        ? {
            on,
            protein: String(engineTarget.proteinGrams),
            carbs: String(engineTarget.carbsGrams),
            fat: String(engineTarget.fatGrams),
          }
        : { ...current, on },
    );
  };

  const onSubmit = () => {
    setSubmitted(true);
    if (!parsed || customParsed.error) {
      haptics.error();
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    submit.mutate(
      {
        program: {
          ...parsed.program,
          activeWeightGoalId: program.activeWeightGoalId ?? goal?.id ?? null,
        },
        goal: goalChanged(goal, parsed) ? goalBody(parsed) : undefined,
        targets: customParsed.grams,
      },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: () => {
          haptics.error();
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        },
      },
    );
  };
  const submitOnce = useSinglePress(onSubmit);

  return (
    <>
      <Stack.Screen options={{ title: "Check-in", gestureEnabled: !dirty }} />
      <Stack.Toolbar placement="left">
        {toolbarText({ onPress: () => router.back(), children: "Cancel" })}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {toolbarText({
          variant: "done",
          disabled: submit.isPending,
          onPress: submitOnce,
          children: "Check in",
        })}
      </Stack.Toolbar>
      <ScrollScreen ref={scrollRef}>
        <VStack>
          {submit.error ? (
            <InlineNotice message={errorMessage(submit.error)} />
          ) : null}
          {submitted && !parsed ? (
            <InlineNotice message="Check the highlighted fields." />
          ) : null}

          <WeekRecap
            data={data}
            energyUnit={energyUnit}
            weightUnit={weightUnit}
          />

          <Section
            title="Next week"
            footer={
              custom.on
                ? "Custom targets last until the next check-in, which goes back to your program."
                : undefined
            }
          >
            <View style={styles.block}>
              <Stat
                label="Calories"
                value={formatInteger(energyValue(shown.calories, energyUnit))}
                unit={energyLabel(energyUnit)}
                size="hero"
                detail={
                  change == null
                    ? undefined
                    : Math.round(change) === 0
                      ? "Same as now"
                      : `${formatSignedEnergy(change, energyUnit)} vs now`
                }
              />
              <MacroTargets
                protein={shown.proteinGrams}
                carbs={shown.carbsGrams}
                fat={shown.fatGrams}
              />
              {notes.length > 0 ? (
                <Text variant="footnote" tone="secondary">
                  {notes.join("\n")}
                </Text>
              ) : null}
            </View>
            <Row
              title="Custom targets"
              separator={custom.on}
              trailing={
                <Switch value={custom.on} onValueChange={toggleCustom} />
              }
            />
            {custom.on ? (
              <View style={styles.fields}>
                {(
                  [
                    ["protein", "Protein"],
                    ["carbs", "Carbs"],
                    ["fat", "Fat"],
                  ] as const
                ).map(([key, label]) => (
                  <TextField
                    key={key}
                    label={label}
                    keyboardType="decimal-pad"
                    suffix="g"
                    value={custom[key]}
                    onChangeText={(value) =>
                      setCustom((current) => ({ ...current, [key]: value }))
                    }
                  />
                ))}
                {customParsed.error && submitted ? (
                  <Text variant="footnote" tone="destructive">
                    {customParsed.error}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Section>

          <ProgramFields
            draft={draft}
            setDraft={setDraft}
            errors={visibleErrors}
            rateKg={parsed?.rateKg ?? null}
            currentKg={currentKg}
            weightUnit={weightUnit}
            energyUnit={energyUnit}
          />
        </VStack>
      </ScrollScreen>
    </>
  );
}

function WeekRecap({
  data,
  energyUnit,
  weightUnit,
}: {
  data: MacrosCheckInResponse;
  energyUnit: EnergyUnit;
  weightUnit: WeightUnit;
}) {
  const { expenditure, week } = data;
  const radius = confidenceRadius(expenditure.varianceKcal2);
  const tdeeChange =
    expenditure.previousTdeeKcal != null
      ? expenditure.tdeeKcal - expenditure.previousTdeeKcal
      : null;
  const trendChange =
    week.trendStartKg != null && week.trendEndKg != null
      ? week.trendEndKg - week.trendStartKg
      : null;

  const rows: Array<{ title: string; value: string; subtitle?: string }> = [
    {
      title: "Expenditure",
      value: formatEnergyWithUnit(expenditure.tdeeKcal, energyUnit),
      subtitle: [
        radius ? `± ${formatInteger(energyValue(radius, energyUnit))}` : null,
        tdeeChange != null && Math.round(tdeeChange) !== 0
          ? `${formatSignedEnergy(tdeeChange, energyUnit)} since last target`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      title: "Average intake",
      value:
        week.averageIntakeKcal != null
          ? formatEnergyWithUnit(week.averageIntakeKcal, energyUnit)
          : "—",
      subtitle: `${week.loggedDays} of 7 days logged`,
    },
    {
      title: "Trend weight",
      value:
        trendChange != null ? formatWeightDelta(trendChange, weightUnit) : "—",
      subtitle:
        week.trendEndKg != null
          ? `Now ${formatWeight(week.trendEndKg, weightUnit)}`
          : undefined,
    },
    { title: "Weigh-ins", value: String(week.weighIns) },
  ];

  return (
    <Section title="Last 7 days">
      {rows.map((row, index) => (
        <Row
          key={row.title}
          title={row.title}
          subtitle={row.subtitle || undefined}
          value={row.value}
          separator={index < rows.length - 1}
        />
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  spinner: {
    paddingVertical: spacing.xxxl,
  },
  notice: {
    padding: spacing.lg,
  },
  block: {
    gap: spacing.lg,
    paddingBottom: spacing.md,
  },
  fields: {
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
