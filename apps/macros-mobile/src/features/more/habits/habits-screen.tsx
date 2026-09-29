import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import { type Habit, useSetHabitCompletion } from "@/api/habits";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  EmptyState,
  Flash,
  Hairline,
  Icon,
  Screen,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { SegmentedControl } from "@/ui/segmented-control";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";
import { doneThisWeek, habitStreak, trailingDays } from "./habit-dates";

const WINDOWS = [30, 90] as const;
const CELLS_PER_ROW = 15;

export function HabitsScreen() {
  const router = useRouter();
  const overview = useBodyOverview();
  const setCompletion = useSetHabitCompletion();
  const { notice, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(overview.refetch);
  const [span, setSpan] = useState<(typeof WINDOWS)[number]>(30);
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);

  const habits = overview.data?.habits ?? [];
  const today = overview.data?.today;

  function openNew() {
    router.push("/more/new-habit");
  }

  function toggle(habit: Habit, done: boolean) {
    if (!today) return;
    if (done) haptics.selection();
    else haptics.success();
    setFlash({ id: habit.id, at: Date.now() });
    setCompletion.mutate(
      { habitId: habit.id, logDate: today, completed: !done },
      { onError: showError },
    );
  }

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.plus}
          iconRenderingMode="template"
          accessibilityLabel="New habit"
          onPress={openNew}
        />
      </Stack.Toolbar>
      <Screen
        stickyHeaderIndices={[0]}
        onRefresh={onRefresh}
        refreshing={refreshing}
      >
        <NoticeSlot notice={notice} onDismiss={clear} />
        <VStack>
          {overview.data && habits.length === 0 ? (
            <EmptyState
              icon="list-checks"
              title="No habits yet"
              message="Small daily things you want to keep up — a walk, vitamins, a glass of water before bed."
            >
              <Button
                label="New Habit"
                size="regular"
                variant="tinted"
                onPress={openNew}
              />
            </EmptyState>
          ) : null}

          {habits.length > 0 && today ? (
            <>
              <SegmentedControl
                values={WINDOWS.map((days) => `${days} days`)}
                selectedIndex={WINDOWS.indexOf(span)}
                onChange={(event) => {
                  const next = WINDOWS[event.nativeEvent.selectedSegmentIndex];
                  if (!next) return;
                  haptics.selection();
                  setSpan(next);
                }}
              />
              <View>
                {habits.map((habit, index) => (
                  <HabitRow
                    key={habit.id}
                    habit={habit}
                    today={today}
                    days={span}
                    flashToken={flash?.id === habit.id ? flash.at : null}
                    last={index === habits.length - 1}
                    onToggle={toggle}
                  />
                ))}
              </View>
              <Text variant="footnote" tone="secondary">
                Tap a habit to tick it off for today.
              </Text>
            </>
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}

function HabitRow({
  habit,
  today,
  days,
  flashToken,
  last,
  onToggle,
}: {
  habit: Habit;
  today: string;
  days: number;
  flashToken: number | null;
  last: boolean;
  onToggle: (habit: Habit, done: boolean) => void;
}) {
  const completed = new Set(habit.completedDates);
  const done = completed.has(today);
  const streak = habitStreak(completed, today);
  const week = doneThisWeek(completed, today);
  const dates = trailingDays(today, days);
  const inWindow = dates.filter((date) => completed.has(date)).length;

  return (
    <Flash token={flashToken}>
      <Pressable
        onPress={() => onToggle(habit, done)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={habit.name}
        accessibilityValue={{
          text: `${streak} day streak, ${week} of ${habit.targetPerWeek} this week`,
        }}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.fill },
        ]}
      >
        <View style={styles.heading}>
          <Icon
            name={done ? "circle-check" : "circle"}
            size={26}
            color={done ? colors.label : colors.tertiaryLabel}
          />
          <View style={styles.text}>
            <Text variant="body" weight="medium">
              {habit.name}
            </Text>
            <Text variant="footnote" tone="secondary" figure>
              {streak > 0 ? `${streak}-day streak · ` : ""}
              {week} of {habit.targetPerWeek} this week
            </Text>
          </View>
          <Text variant="footnote" tone="secondary" figure>
            {inWindow}/{days}
          </Text>
        </View>
        <View
          style={styles.grid}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          {dates.map((date) => (
            <View key={date} style={styles.cell}>
              <View
                style={[
                  styles.square,
                  {
                    backgroundColor: completed.has(date)
                      ? colors.label
                      : colors.fill,
                  },
                ]}
              />
            </View>
          ))}
        </View>
      </Pressable>
      {last ? null : <Hairline />}
    </Flash>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / CELLS_PER_ROW}%`,
    aspectRatio: 1,
    padding: 1.5,
  },
  square: {
    flex: 1,
    borderRadius: 2,
  },
});
