import { type MacrosHabitIcon, macrosHabitIcons } from "@repo/schemas/macros";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import {
  type Habit,
  useArchiveHabit,
  useCreateHabit,
  useUpdateHabit,
} from "@/api/habits";
import {
  forgetHabitReminder,
  habitReminder,
  updateHabitReminder,
  useReminderSettings,
} from "@/features/notifications/reminder-settings";
import { ReminderTimeRow } from "@/features/notifications/reminder-time-row";
import { useNotificationPermission } from "@/features/notifications/use-permission";
import { WeekdayToggles } from "@/features/progress/controls";
import { planWeekdayNames } from "@/features/progress/labels";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  EmptyState,
  Row,
  Screen,
  Section,
  SheetHeader,
  sheetGutter,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { SegmentedControl } from "@/ui/segmented-control";
import { Stepper } from "@/ui/stepper";
import { confirmDestructive } from "../shared/action-sheet";
import { NoticeSlot, useNotice } from "../shared/notice";
import { scheduleLabel } from "./habit-dates";
import { HabitGlyph } from "./habit-glyph";

const MODES = ["Flexible", "Set days"] as const;
const ICONS_PER_ROW = 6;

function iconLabel(icon: MacrosHabitIcon) {
  return icon.replace(/-/g, " ");
}

export function HabitEditorSheet() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const overview = useBodyOverview();
  const found = id
    ? overview.data?.habits.find((candidate) => candidate.id === id)
    : undefined;
  // Archiving refetches the list while the sheet is still closing; keep the
  // form that was on screen rather than flash an empty one.
  const lastSeen = useRef<Habit | undefined>(undefined);
  if (found) lastSeen.current = found;
  const habit = found ?? lastSeen.current;
  if (id && !habit) {
    if (overview.isSuccess && !overview.isFetching) return <HabitGone />;
    // Wait for the habit being edited rather than open an empty form over it.
    return <HabitEditor key="loading" habit={undefined} editing />;
  }
  return <HabitEditor key={habit?.id ?? "new"} habit={habit} editing={!!id} />;
}

function HabitGone() {
  const router = useRouter();
  return (
    <Screen contentContainerStyle={styles.sheet}>
      <VStack gap={spacing.xl}>
        <SheetHeader title="Edit habit" onClose={() => router.back()} />
        <EmptyState
          icon="archive"
          title="Habit archived"
          message="This habit was archived on another device."
        >
          <Button label="Close" onPress={() => router.back()} />
        </EmptyState>
      </VStack>
    </Screen>
  );
}

function HabitEditor({
  habit,
  editing,
}: {
  habit: Habit | undefined;
  editing: boolean;
}) {
  const router = useRouter();
  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const archiveHabit = useArchiveHabit();
  const { notice, showError, clear } = useNotice();
  const { settings, loaded } = useReminderSettings();
  const { permission, ensure } = useNotificationPermission();

  const [name, setName] = useState(habit?.name ?? "");
  const [icon, setIcon] = useState<MacrosHabitIcon | null>(habit?.icon ?? null);
  const [mode, setMode] = useState<(typeof MODES)[number]>(
    habit?.weekdays ? "Set days" : "Flexible",
  );
  const [target, setTarget] = useState(habit?.targetPerWeek ?? 7);
  const [weekdays, setWeekdays] = useState<number[]>(
    habit?.weekdays ?? [0, 2, 4],
  );
  const [reminder, setReminder] = useState(() =>
    habitReminder(settings, habit?.id ?? ""),
  );
  const [reminderTouched, setReminderTouched] = useState(false);

  const trimmed = name.trim();
  const scheduled = mode === "Set days";
  const valid = trimmed.length > 0 && (!scheduled || weekdays.length > 0);
  const saving = createHabit.isPending || updateHabit.isPending;
  // Until the stored settings arrive, show what is stored rather than a draft.
  const shownReminder =
    loaded && !reminderTouched && habit
      ? habitReminder(settings, habit.id)
      : reminder;
  const reminderOn = shownReminder.enabled && permission !== "denied";

  function saveReminder(habitId: string) {
    if (reminderTouched) updateHabitReminder(habitId, reminder);
  }

  function save() {
    if (!valid) return;
    clear();
    const schedule = scheduled
      ? { weekdays, targetPerWeek: weekdays.length }
      : { weekdays: null, targetPerWeek: target };
    const done = () => {
      haptics.success();
      router.back();
    };
    if (habit) {
      updateHabit.mutate(
        { id: habit.id, name: trimmed, icon, ...schedule },
        {
          onSuccess: () => {
            saveReminder(habit.id);
            done();
          },
          onError: showError,
        },
      );
      return;
    }
    createHabit.mutate(
      { name: trimmed, icon, ...schedule },
      {
        onSuccess: (created) => {
          saveReminder(created.id);
          done();
        },
        onError: showError,
      },
    );
  }

  function archive() {
    if (!habit) return;
    confirmDestructive({
      title: `Archive “${habit.name}”?`,
      message: "It leaves your lists. Days you ticked stay in your history.",
      confirmLabel: "Archive Habit",
      onConfirm: () => {
        clear();
        archiveHabit.mutate(habit.id, {
          onSuccess: () => {
            forgetHabitReminder(habit.id);
            haptics.success();
            router.back();
          },
          onError: showError,
        });
      },
    });
  }

  function editReminder(patch: Partial<typeof reminder>) {
    setReminderTouched(true);
    setReminder({ ...shownReminder, ...patch });
  }

  async function toggleReminder(on: boolean) {
    haptics.selection();
    editReminder({ enabled: on });
    if (on && !(await ensure())) {
      editReminder({ enabled: false });
    }
  }

  return (
    <Screen contentContainerStyle={styles.sheet}>
      <VStack gap={spacing.xl}>
        <SheetHeader
          title={editing ? "Edit habit" : "New habit"}
          subtitle={
            valid
              ? scheduleLabel(scheduled ? weekdays : null, target)
              : undefined
          }
          leading={
            <View style={styles.artwork}>
              <HabitGlyph icon={icon} size={24} color={colors.label} />
            </View>
          }
          onClose={() => router.back()}
        />

        <TextField
          label="Habit"
          value={name}
          onChangeText={setName}
          placeholder="Evening walk"
          autoFocus={!editing}
          autoCapitalize="sentences"
          maxLength={80}
          returnKeyType="done"
        />

        <View style={styles.icons} accessibilityRole="radiogroup">
          {macrosHabitIcons.map((option) => {
            const selected = option === icon;
            return (
              <View key={option} style={styles.iconCell}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={iconLabel(option)}
                  accessibilityState={{ selected }}
                  hitSlop={2}
                  onPress={() => {
                    haptics.selection();
                    setIcon(selected ? null : option);
                  }}
                  style={({ pressed }) => [
                    styles.iconButton,
                    {
                      backgroundColor: selected
                        ? colors.label
                        : colors.tertiaryFill,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <HabitGlyph
                    icon={option}
                    size={20}
                    color={selected ? colors.background : colors.label}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>

        <Section title="Schedule">
          <View style={styles.schedule}>
            <SegmentedControl
              values={[...MODES]}
              selectedIndex={MODES.indexOf(mode)}
              onChange={(event) => {
                const next = MODES[event.nativeEvent.selectedSegmentIndex];
                if (!next) return;
                haptics.selection();
                setMode(next);
              }}
            />
            {scheduled ? (
              <WeekdayToggles
                labels={planWeekdayNames}
                selected={weekdays}
                onToggle={(weekday) =>
                  setWeekdays((days) =>
                    days.includes(weekday)
                      ? days.filter((day) => day !== weekday)
                      : [...days, weekday].sort((a, b) => a - b),
                  )
                }
              />
            ) : (
              <Stepper
                label={scheduleLabel(null, target)}
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
            )}
            <Text variant="footnote" tone="secondary">
              {scheduled
                ? "Due only on these days. Days off never break a streak."
                : "Any days count. Reminders stop once the week's target is met."}
            </Text>
          </View>
        </Section>

        <Section title="Reminder">
          <Row
            icon="bell"
            title="Remind me"
            subtitle={
              permission === "denied"
                ? "Notifications are off for Macros in Settings."
                : undefined
            }
            separator={reminderOn}
            trailing={
              <Switch
                value={reminderOn}
                disabled={!loaded || permission === "denied"}
                onValueChange={(on) => void toggleReminder(on)}
              />
            }
          />
          {reminderOn ? (
            <ReminderTimeRow
              hour={shownReminder.hour}
              minute={shownReminder.minute}
              separator={false}
              onChange={(hour, minute) => editReminder({ hour, minute })}
            />
          ) : null}
        </Section>

        <NoticeSlot notice={notice} onDismiss={clear} />

        <View style={styles.actions}>
          <Button
            label={editing ? "Save" : "Add Habit"}
            disabled={!valid || (editing && !habit)}
            loading={saving}
            onPress={save}
          />
          {habit ? (
            <Button
              label="Archive Habit"
              variant="destructive"
              icon="archive"
              loading={archiveHabit.isPending}
              onPress={archive}
            />
          ) : null}
        </View>
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingTop: spacing.xl,
    paddingHorizontal: sheetGutter,
    paddingBottom: spacing.xxl,
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  icons: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -spacing.sm,
  },
  iconCell: {
    width: `${100 / ICONS_PER_ROW}%`,
    aspectRatio: 1,
    padding: spacing.sm,
  },
  iconButton: {
    flex: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  schedule: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  control: {
    alignSelf: "stretch",
  },
  actions: {
    gap: spacing.sm,
  },
});
