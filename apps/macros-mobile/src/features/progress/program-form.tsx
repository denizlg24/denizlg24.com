import type { MacrosActiveGoal, MacrosProgram } from "@repo/schemas/macros";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, type ScrollView, StyleSheet } from "react-native";
import { invalidateAfterGoalChange, updateActiveGoal } from "@/api/goals";
import {
  invalidateAfterTargetChange,
  saveProgram,
  useNutritionProgram,
  useStrategy,
} from "@/api/strategy";
import { useWeightOverview } from "@/api/weight";
import { errorMessage } from "@/lib/api";
import type { EnergyUnit, WeightUnit } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useSinglePress } from "@/lib/use-single-press";
import { InlineNotice, spacing, VStack } from "@/ui";
import { toolbarText } from "@/ui/toolbar";
import {
  goalBody,
  goalChanged,
  initialDraft,
  type ParsedDraft,
  parseDraft,
  preferencesUnchanged,
  visibleDraftErrors,
} from "./program-draft";
import { ProgramFields } from "./program-fields";
import { ScrollScreen } from "./scroll-screen";
import { useUnits } from "./use-units";
import { currentWeightKg } from "./weight-progress";

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
  const visibleErrors = visibleDraftErrors(draft, errors, submitted);

  const save = useMutation({
    mutationFn: async (next: ParsedDraft) => {
      let goalId = program?.activeWeightGoalId ?? goal?.id ?? null;
      const changedGoal = goalChanged(goal, next);
      if (changedGoal) {
        const saved = await updateActiveGoal(goalBody(next));
        goalId = saved.goal.id;
      }
      // A goal change re-issues targets and copies the goal type onto the
      // program by itself; saving an otherwise unchanged program on top would
      // leave a second, identical issue in the check-in history.
      const needsProgramSave =
        !program ||
        !preferencesUnchanged(program, next.program) ||
        (!changedGoal && program.goalType !== next.program.goalType);
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

const styles = StyleSheet.create({
  spinner: {
    paddingVertical: spacing.xxxl,
  },
});
