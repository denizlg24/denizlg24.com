import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import { type Habit, useSetHabitCompletion } from "@/api/habits";
import { useProfile } from "@/api/profile";
import { deviceTimeZone, useToday } from "@/lib/day";
import { formatDayLabel } from "@/lib/format";
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
import {
  habitStatus,
  isDueOn,
  scheduleLabel,
  trailingDays,
} from "./habit-dates";
import { HabitGlyph } from "./habit-glyph";

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
  const today = useToday(useProfile().data?.timezone ?? deviceTimeZone());

  function openNew() {
    router.push("/more/habit");
  }

  function openHabit(habit: Habit) {
    router.push({ pathname: "/more/habit", params: { id: habit.id } });
  }

  function toggle(habit: Habit, done: boolean, logDate = today) {
    if (done) haptics.selection();
    else haptics.success();
    setFlash({ id: habit.id, at: Date.now() });
    setCompletion.mutate(
      { habitId: habit.id, logDate, completed: !done },
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
                    onOpen={openHabit}
                  />
                ))}
              </View>
              <Text variant="footnote" tone="secondary">
                Tap a day in the grid to fill in or clear a missed tick.
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
  onOpen,
}: {
  habit: Habit;
  today: string;
  days: number;
  flashToken: number | null;
  last: boolean;
  onToggle: (habit: Habit, done: boolean, logDate?: string) => void;
  onOpen: (habit: Habit) => void;
}) {
  const completed = new Set(habit.completedDates);
  const status = habitStatus(habit, today);
  const dates = trailingDays(today, days);
  const summary = [
    scheduleLabel(habit.weekdays, habit.targetPerWeek),
    status.streak > 0 ? `${status.streak}-day streak` : null,
    status.best > status.streak ? `best ${status.best}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Flash token={flashToken}>
      <View style={styles.row}>
        <View style={styles.heading}>
          <Pressable
            onPress={() => onOpen(habit)}
            accessibilityRole="button"
            accessibilityLabel={`${habit.name}, ${summary}`}
            accessibilityHint="Edit the habit"
            style={({ pressed }) => [styles.title, pressed && styles.pressed]}
          >
            <HabitGlyph icon={habit.icon} size={20} />
            <View style={styles.text}>
              <Text variant="body" weight="medium" numberOfLines={1}>
                {habit.name}
              </Text>
              <Text variant="footnote" tone="secondary" figure>
                {summary}
              </Text>
            </View>
            <Text variant="footnote" tone="secondary" figure>
              {status.week}/{status.weekTarget}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onToggle(habit, status.done)}
            hitSlop={10}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: status.done }}
            accessibilityLabel={`${habit.name} today`}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Icon
              name={status.done ? "circle-check" : "circle"}
              size={28}
              color={
                status.done
                  ? colors.label
                  : status.due
                    ? colors.secondaryLabel
                    : colors.tertiaryLabel
              }
            />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {dates.map((date) => {
            const done = completed.has(date);
            const due = isDueOn(habit.weekdays, date);
            return (
              <Pressable
                key={date}
                onPress={() => onToggle(habit, done, date)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={`${habit.name}, ${formatDayLabel(date, today)}${due ? "" : ", day off"}`}
                style={({ pressed }) => [
                  styles.cell,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.square,
                    done
                      ? { backgroundColor: colors.label }
                      : due
                        ? { backgroundColor: colors.fill }
                        : styles.offDay,
                    date === today && !done && styles.today,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
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
    gap: spacing.lg,
  },
  title: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  offDay: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  today: {
    borderWidth: 1,
    borderColor: colors.secondaryLabel,
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
