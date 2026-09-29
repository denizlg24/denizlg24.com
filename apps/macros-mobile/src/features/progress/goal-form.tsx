import type { MacrosActiveGoal, MacrosGoalType } from "@repo/schemas/macros";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  type GoalInput,
  useActiveGoal,
  useCreateGoal,
  useUpdateActiveGoal,
} from "@/api/goals";
import { useWeightOverview } from "@/api/weight";
import { errorMessage } from "@/lib/api";
import {
  formatDecimal,
  kgFromUnit,
  type WeightUnit,
  weightValue,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useSinglePress } from "@/lib/use-single-press";
import {
  Button,
  Hairline,
  InlineNotice,
  parseDecimal,
  Section,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";
import { toolbarText } from "@/ui/toolbar";
import { Segmented } from "./controls";
import { goalTypeOptions } from "./labels";
import { ScrollScreen } from "./scroll-screen";
import { useUnits } from "./use-units";
import { currentWeightKg } from "./weight-progress";

interface Draft {
  goalType: MacrosGoalType;
  target: string;
  rate: string;
  targetDate: string | null;
  start: string;
}

type DraftErrors = Partial<Record<"target" | "rate" | "start", string>>;

const MAX_KG = 999;
const MAX_RATE_KG = 2;

function trimNumber(value: number, digits: number): string {
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

export function GoalFormScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const goal = useActiveGoal();
  const overview = useWeightOverview();

  if (goal.isPending) {
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

  const active = goal.data ?? null;
  return (
    <GoalForm
      existing={mode === "edit" ? active : null}
      replacing={mode !== "edit" && active !== null}
      currentKg={currentWeightKg(overview.data)}
    />
  );
}

function GoalForm({
  existing,
  replacing,
  currentKg,
}: {
  existing: MacrosActiveGoal | null;
  replacing: boolean;
  currentKg: number | null;
}) {
  const router = useRouter();
  const { weightUnit, today } = useUnits();
  const scrollRef = useRef<ScrollView>(null);
  const create = useCreateGoal();
  const update = useUpdateActiveGoal();
  const saving = create.isPending || update.isPending;
  const failure = create.error ?? update.error;

  const initial = useMemo<Draft>(
    () => ({
      goalType: existing?.goalType ?? "lose",
      target:
        existing?.targetWeightKg != null
          ? trimNumber(weightValue(existing.targetWeightKg, weightUnit), 1)
          : "",
      rate:
        existing?.weeklyRateKg != null && existing.weeklyRateKg > 0
          ? trimNumber(weightValue(existing.weeklyRateKg, weightUnit), 2)
          : "",
      targetDate: existing?.targetDate ?? null,
      start:
        currentKg != null
          ? trimNumber(weightValue(currentKg, weightUnit), 1)
          : "",
    }),
    [existing, currentKg, weightUnit],
  );
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const directional = draft.goalType !== "maintain";
  const targetValue = parseDecimal(draft.target);
  const targetKg =
    targetValue == null ? null : kgFromUnit(targetValue, weightUnit);
  const rateValue = parseDecimal(draft.rate);
  const rateKg = rateValue == null ? null : kgFromUnit(rateValue, weightUnit);
  const startValue = parseDecimal(draft.start);
  const startKg =
    startValue == null ? null : kgFromUnit(startValue, weightUnit);
  const referenceKg = existing ? currentKg : (startKg ?? currentKg);

  const errors: DraftErrors = {};
  const weightLimit = `Up to ${formatDecimal(weightValue(MAX_KG, weightUnit))} ${weightUnit}`;
  if (
    draft.target.trim() !== "" &&
    (targetKg == null || targetKg <= 0 || targetKg > MAX_KG)
  ) {
    errors.target = weightLimit;
  } else if (directional && targetKg == null) {
    errors.target = "Enter the weight you’re aiming for";
  }
  if (directional && (rateKg == null || rateKg <= 0 || rateKg > MAX_RATE_KG)) {
    errors.rate = `More than 0 and up to ${formatDecimal(weightValue(MAX_RATE_KG, weightUnit))} ${weightUnit} a week`;
  }
  if (
    !existing &&
    draft.start.trim() !== "" &&
    (startKg == null || startKg <= 0 || startKg > MAX_KG)
  ) {
    errors.start = weightLimit;
  }
  const visible = (key: keyof DraftErrors, text: string) =>
    submitted || text.trim() !== "" ? errors[key] : undefined;
  const valid = Object.keys(errors).length === 0;

  const wrongDirection =
    referenceKg != null &&
    targetKg != null &&
    ((draft.goalType === "lose" && targetKg >= referenceKg) ||
      (draft.goalType === "gain" && targetKg <= referenceKg));

  const onSave = () => {
    setSubmitted(true);
    if (!valid) {
      haptics.error();
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (existing && !dirty) {
      router.back();
      return;
    }
    const body: GoalInput = {
      goalType: draft.goalType,
      ...(targetKg != null ? { targetWeightKg: targetKg } : {}),
      ...(draft.targetDate ? { targetDate: draft.targetDate } : {}),
      ...(directional && rateKg != null ? { weeklyRateKg: rateKg } : {}),
      ...(!existing && startKg != null ? { startWeightKg: startKg } : {}),
    };
    const options = {
      onSuccess: () => {
        haptics.success();
        router.back();
      },
      onError: () => {
        haptics.error();
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      },
    };
    if (existing) update.mutate(body, options);
    else create.mutate(body, options);
  };

  const tomorrow = addDays(parseISO(today), 1);
  const insights = goalInsights({
    goalType: draft.goalType,
    referenceKg,
    targetKg,
    rateKg,
    targetDate: draft.targetDate,
    today,
    unit: weightUnit,
  });

  const saveOnce = useSinglePress(onSave);
  return (
    <>
      <Stack.Screen
        options={{
          title: existing ? "Edit goal" : "New goal",
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
          disabled: saving,
          onPress: saveOnce,
          children: "Save",
        })}
      </Stack.Toolbar>
      <ScrollScreen ref={scrollRef}>
        <VStack>
          {failure ? <InlineNotice message={errorMessage(failure)} /> : null}
          {replacing ? (
            <InlineNotice
              tone="info"
              message="Saving starts a new goal. Your current one moves to history."
            />
          ) : null}

          <Section title="Goal">
            <View style={styles.fields}>
              <Segmented
                options={goalTypeOptions}
                value={draft.goalType}
                onChange={(value) => set("goalType", value)}
              />
              <TextField
                label={directional ? "Goal weight" : "Weight to hold"}
                keyboardType="decimal-pad"
                suffix={weightUnit}
                placeholder={directional ? undefined : "Optional"}
                value={draft.target}
                onChangeText={(value) => set("target", value)}
                error={visible("target", draft.target)}
                hint={
                  wrongDirection
                    ? draft.goalType === "lose"
                      ? "That’s not below your current weight."
                      : "That’s not above your current weight."
                    : undefined
                }
              />
              {directional ? (
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
                  error={visible("rate", draft.rate)}
                  hint="Your weekly targets are set to hit this rate."
                />
              ) : null}
              {!existing ? (
                <TextField
                  label="Starting weight"
                  keyboardType="decimal-pad"
                  suffix={weightUnit}
                  value={draft.start}
                  onChangeText={(value) => set("start", value)}
                  error={visible("start", draft.start)}
                  hint="Your latest trend weight, unless you change it."
                />
              ) : null}
            </View>
          </Section>

          <Section title="Deadline">
            <View style={styles.dateRow}>
              <Text variant="body" style={styles.dateLabel}>
                Target date
              </Text>
              {draft.targetDate ? (
                <DateTimePicker
                  value={parseISO(draft.targetDate)}
                  mode="date"
                  display="compact"
                  minimumDate={tomorrow}
                  onValueChange={(_event, date) => {
                    haptics.selection();
                    set("targetDate", format(date, "yyyy-MM-dd"));
                  }}
                />
              ) : (
                <Button
                  label="Add"
                  variant="tinted"
                  size="small"
                  block={false}
                  onPress={() =>
                    set(
                      "targetDate",
                      format(addDays(parseISO(today), 84), "yyyy-MM-dd"),
                    )
                  }
                />
              )}
            </View>
            {draft.targetDate && !existing?.targetDate ? (
              <>
                <Hairline />
                <Button
                  label="Remove date"
                  variant="plain"
                  size="regular"
                  block={false}
                  style={styles.remove}
                  onPress={() => set("targetDate", null)}
                />
              </>
            ) : null}
          </Section>

          {insights.length > 0 ? (
            <View style={styles.insights}>
              {insights.map((line) => (
                <Text key={line} variant="footnote" tone="secondary">
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </VStack>
      </ScrollScreen>
    </>
  );
}

/** Plain-language consequences of the numbers entered, recomputed as they change. */
function goalInsights({
  goalType,
  referenceKg,
  targetKg,
  rateKg,
  targetDate,
  today,
  unit,
}: {
  goalType: MacrosGoalType;
  referenceKg: number | null;
  targetKg: number | null;
  rateKg: number | null;
  targetDate: string | null;
  today: string;
  unit: WeightUnit;
}): string[] {
  if (goalType === "maintain" || referenceKg == null || targetKg == null)
    return [];
  const distance = Math.abs(targetKg - referenceKg);
  const towards =
    (goalType === "lose" && targetKg < referenceKg) ||
    (goalType === "gain" && targetKg > referenceKg);
  if (!towards || distance < 0.05) return [];
  const lines = [
    `${formatDecimal(weightValue(distance, unit))} ${unit} to ${goalType === "lose" ? "lose" : "gain"}.`,
  ];
  if (rateKg != null && rateKg > 0) {
    const weeks = distance / rateKg;
    const arrival = addDays(parseISO(today), Math.round(weeks * 7));
    lines.push(
      `At that rate you’d get there around ${format(arrival, "d MMM yyyy")} (${Math.ceil(weeks)} weeks).`,
    );
  }
  if (targetDate) {
    const days = differenceInCalendarDays(
      parseISO(targetDate),
      parseISO(today),
    );
    if (days > 0) {
      const needed = distance / (days / 7);
      lines.push(
        `Reaching it by ${format(parseISO(targetDate), "d MMM")} takes about ${formatDecimal(weightValue(needed, unit))} ${unit} a week.`,
      );
    }
  }
  return lines;
}

const styles = StyleSheet.create({
  spinner: {
    paddingVertical: spacing.xxxl,
  },
  fields: {
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  dateLabel: {
    flex: 1,
  },
  remove: {
    alignSelf: "flex-start",
  },
  insights: {
    gap: spacing.xs,
  },
});
