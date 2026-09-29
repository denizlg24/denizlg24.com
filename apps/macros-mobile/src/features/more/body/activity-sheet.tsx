import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useBodyOverview, useUpsertActivity } from "@/api/body";
import { useProfile } from "@/api/profile";
import { useToday } from "@/lib/day";
import { energyLabel, energyValue } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { parseDecimal } from "@/lib/numbers";
import { Button, sheetGutter, spacing, Text, TextField } from "@/ui";
import { NoticeSlot, useNotice } from "../shared/notice";

const KJ_PER_KCAL = 4.184;

function initial(value: number | null | undefined, digits = 0) {
  return value === null || value === undefined
    ? ""
    : String(Number(value.toFixed(digits)));
}

/** Today's manual steps and active energy; an imported row is left alone. */
export function ActivitySheet() {
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const today = useToday(profile.data?.timezone);
  const overview = useBodyOverview();
  const upsert = useUpsertActivity();
  const { notice, showError, clear } = useNotice();

  const manual = overview.data?.activity.find(
    (entry) =>
      entry.logDate === (overview.data?.today ?? today) &&
      entry.source === "manual",
  );
  const [initialValues] = useState(() => ({
    steps: initial(manual?.steps),
    energy: initial(
      manual?.activeEnergyKcal === null ||
        manual?.activeEnergyKcal === undefined
        ? null
        : energyValue(manual.activeEnergyKcal, energyUnit),
    ),
  }));
  const [steps, setSteps] = useState(initialValues.steps);
  const [energy, setEnergy] = useState(initialValues.energy);

  const parsedSteps = steps.trim() === "" ? null : parseDecimal(steps);
  const parsedEnergy = energy.trim() === "" ? null : parseDecimal(energy);
  const stepsValid =
    parsedSteps === null ||
    (Number.isInteger(parsedSteps) &&
      parsedSteps >= 0 &&
      parsedSteps <= 200_000);
  const energyKcal =
    parsedEnergy === null
      ? null
      : energyUnit === "kj"
        ? parsedEnergy / KJ_PER_KCAL
        : parsedEnergy;
  const energyValid =
    energyKcal === null || (energyKcal >= 0 && energyKcal <= 10_000);
  const changed =
    steps !== initialValues.steps || energy !== initialValues.energy;
  const valid = stepsValid && energyValid;

  function save() {
    if (!valid) return;
    clear();
    upsert.mutate(
      {
        logDate: overview.data?.today ?? today,
        steps: parsedSteps,
        activeEnergyKcal: energyKcal,
      },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: showError,
      },
    );
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text variant="headline">Activity today</Text>
        <Text variant="footnote" tone="secondary">
          Copy the numbers from the Health or Fitness app. Leave a field empty
          to clear it.
        </Text>
      </View>
      <View style={styles.pair}>
        <TextField
          label="Steps"
          value={steps}
          onChangeText={setSteps}
          keyboardType="number-pad"
          placeholder="0"
          autoFocus
          containerStyle={styles.half}
          error={stepsValid ? undefined : "Whole steps, up to 200,000."}
        />
        <TextField
          label="Active energy"
          value={energy}
          onChangeText={setEnergy}
          keyboardType="decimal-pad"
          placeholder="0"
          suffix={energyLabel(energyUnit)}
          containerStyle={styles.half}
          error={energyValid ? undefined : "That’s more than a day allows."}
        />
      </View>
      <NoticeSlot notice={notice} onDismiss={clear} />
      <Button
        label="Save"
        disabled={!valid || !changed}
        loading={upsert.isPending}
        onPress={save}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: sheetGutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  pair: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  half: {
    flex: 1,
  },
});
