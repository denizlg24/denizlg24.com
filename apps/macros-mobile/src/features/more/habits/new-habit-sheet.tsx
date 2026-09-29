import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCreateHabit } from "@/api/habits";
import { haptics } from "@/lib/haptics";
import { Button, sheetGutter, spacing, Text, TextField } from "@/ui";
import { Stepper } from "@/ui/stepper";
import { NoticeSlot, useNotice } from "../shared/notice";

function targetLabel(days: number) {
  return days === 7
    ? "Every day"
    : `${days} ${days === 1 ? "day" : "days"} a week`;
}

export function NewHabitSheet() {
  const router = useRouter();
  const createHabit = useCreateHabit();
  const { notice, showError, clear } = useNotice();
  const [name, setName] = useState("");
  const [target, setTarget] = useState(7);

  const trimmed = name.trim();

  function save() {
    if (!trimmed) return;
    clear();
    createHabit.mutate(
      { name: trimmed, targetPerWeek: target },
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
      <Text variant="headline">New habit</Text>
      <TextField
        label="Habit"
        value={name}
        onChangeText={setName}
        placeholder="Evening walk"
        autoFocus
        autoCapitalize="sentences"
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Stepper
        label={targetLabel(target)}
        value={target}
        step={1}
        min={1}
        max={7}
        onValueChange={(value) => {
          haptics.selection();
          setTarget(Math.round(value));
        }}
        style={styles.control}
      />
      <Text variant="footnote" tone="secondary">
        The weekly target sets what counts as on track; streaks still count
        every day you tick it.
      </Text>
      <NoticeSlot notice={notice} onDismiss={clear} />
      <Button
        label="Add Habit"
        disabled={!trimmed}
        loading={createHabit.isPending}
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
  control: {
    alignSelf: "stretch",
  },
});
