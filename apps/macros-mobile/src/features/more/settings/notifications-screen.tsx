import { useState } from "react";
import { Linking, StyleSheet, Switch, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import {
  type UpdateNotificationPreferencesInput,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/api/notifications";
import { HabitGlyph } from "@/features/more/habits/habit-glyph";
import type { ReminderSettings } from "@/features/notifications/reminder-plan";
import {
  habitReminder,
  updateHabitReminder,
  updateReminderSettings,
  useReminderSettings,
} from "@/features/notifications/reminder-settings";
import { ReminderTimeRow } from "@/features/notifications/reminder-time-row";
import { useNotificationPermission } from "@/features/notifications/use-permission";
import { MenuRow, WeekdayToggles } from "@/features/progress/controls";
import { planWeekdayNames } from "@/features/progress/labels";
import { errorMessage, NetworkError } from "@/lib/api";
import { capabilities, DEVICE_NAME } from "@/lib/config";
import { haptics } from "@/lib/haptics";
import { formatHour } from "@/lib/log-time";
import { Row, Screen, Section, spacing, VStack } from "@/ui";
import { type Notice, NoticeSlot, useNotice } from "../shared/notice";

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: formatHour(hour),
}));

export function NotificationsScreen() {
  const { permission, ensure } = useNotificationPermission();
  const reminders = useReminderSettings();
  const habits = useBodyOverview().data?.habits ?? [];
  const preferences = useNotificationPreferences(capabilities.push);
  const updatePreferences = useUpdateNotificationPreferences();
  const { notice, showError, clear } = useNotice();
  const [permissionNoticeDismissed, setPermissionNoticeDismissed] =
    useState(false);

  const granted = permission === "granted";
  const settings = reminders.settings;
  // A switch shows what will actually arrive: an enabled reminder on a phone
  // that refuses notifications is off, and turns on by itself once allowed.
  const logOn = granted && settings.log.enabled;
  const weighInOn = granted && settings.weighIn.enabled;
  const prefs = preferences.data;
  const weeklyOn = granted && Boolean(prefs?.weeklySummary);
  const streakOn = granted && Boolean(prefs?.streakNudge);

  function setReminders(
    update: (current: ReminderSettings) => ReminderSettings,
  ) {
    updateReminderSettings(update);
  }

  async function toggleReminder(kind: "log" | "weighIn", on: boolean) {
    haptics.selection();
    setReminders((current) => ({
      ...current,
      [kind]: { ...current[kind], enabled: on },
    }));
    if (on && !(await ensure())) setPermissionNoticeDismissed(false);
  }

  function patchPreferences(input: UpdateNotificationPreferencesInput) {
    clear();
    updatePreferences.mutate(input, { onError: showError });
  }

  async function toggleHabit(habitId: string, on: boolean) {
    haptics.selection();
    updateHabitReminder(habitId, { enabled: on });
    if (on && !(await ensure())) setPermissionNoticeDismissed(false);
  }

  async function togglePreference(
    key: "weeklySummary" | "streakNudge",
    on: boolean,
  ) {
    haptics.selection();
    if (!on) {
      patchPreferences({ [key]: false });
      return;
    }
    if (prefs && !prefs[key]) patchPreferences({ [key]: true });
    if (!(await ensure())) setPermissionNoticeDismissed(false);
  }

  const permissionNotice: Notice | null =
    permission === "denied" && !permissionNoticeDismissed
      ? {
          message: "Notifications are turned off for Macros.",
          tone: "info",
          action: {
            label: "Open Settings",
            onPress: () => void Linking.openSettings(),
          },
        }
      : null;
  const loadNotice: Notice | null = preferences.error
    ? {
        message: errorMessage(preferences.error),
        tone: preferences.error instanceof NetworkError ? "offline" : "error",
        action: { label: "Retry", onPress: () => void preferences.refetch() },
      }
    : null;
  const shown = notice ?? loadNotice ?? permissionNotice;

  const ready = reminders.loaded && permission !== null;

  return (
    <Screen stickyHeaderIndices={[0]}>
      <NoticeSlot
        notice={shown}
        onDismiss={() => {
          if (notice) clear();
          else setPermissionNoticeDismissed(true);
        }}
      />
      <VStack>
        <Section
          title="Reminders"
          footer={`Set on this ${DEVICE_NAME}. A reminder skips any day it's already done.`}
        >
          <Row
            icon="utensils"
            title="Log food"
            separator
            trailing={
              <Switch
                value={logOn}
                disabled={!ready}
                onValueChange={(on) => void toggleReminder("log", on)}
              />
            }
          />
          {logOn ? (
            <ReminderTimeRow
              hour={settings.log.hour}
              minute={settings.log.minute}
              onChange={(hour, minute) =>
                setReminders((current) => ({
                  ...current,
                  log: { ...current.log, hour, minute },
                }))
              }
            />
          ) : null}
          <Row
            icon="scale"
            title="Weigh in"
            separator={weighInOn}
            trailing={
              <Switch
                value={weighInOn}
                disabled={!ready}
                onValueChange={(on) => void toggleReminder("weighIn", on)}
              />
            }
          />
          {weighInOn ? (
            <>
              <ReminderTimeRow
                hour={settings.weighIn.hour}
                minute={settings.weighIn.minute}
                separator={false}
                onChange={(hour, minute) =>
                  setReminders((current) => ({
                    ...current,
                    weighIn: { ...current.weighIn, hour, minute },
                  }))
                }
              />
              <View style={styles.weekdays}>
                <WeekdayToggles
                  labels={planWeekdayNames}
                  selected={settings.weighIn.weekdays}
                  onToggle={(weekday) =>
                    setReminders((current) => {
                      const days = current.weighIn.weekdays;
                      // With no day left the reminder would read on and never fire.
                      if (days.length === 1 && days[0] === weekday) {
                        return current;
                      }
                      return {
                        ...current,
                        weighIn: {
                          ...current.weighIn,
                          weekdays: days.includes(weekday)
                            ? days.filter((day) => day !== weekday)
                            : [...days, weekday],
                        },
                      };
                    })
                  }
                />
              </View>
            </>
          ) : null}
        </Section>

        {habits.length > 0 ? (
          <Section
            title="Habits"
            footer="Only on days a habit is due and not yet ticked off."
          >
            {habits.map((habit, index) => {
              const reminder = habitReminder(settings, habit.id);
              const on = granted && reminder.enabled;
              const last = index === habits.length - 1;
              return (
                <View key={habit.id}>
                  <Row
                    title={habit.name}
                    leading={<HabitGlyph icon={habit.icon} size={20} />}
                    separator={on || !last}
                    trailing={
                      <Switch
                        value={on}
                        disabled={!ready}
                        onValueChange={(next) =>
                          void toggleHabit(habit.id, next)
                        }
                      />
                    }
                  />
                  {on ? (
                    <ReminderTimeRow
                      hour={reminder.hour}
                      minute={reminder.minute}
                      separator={!last}
                      onChange={(hour, minute) =>
                        updateHabitReminder(habit.id, { hour, minute })
                      }
                    />
                  ) : null}
                </View>
              );
            })}
          </Section>
        ) : null}

        {capabilities.push ? (
          <Section
            title="From Macros"
            footer="Sent to every iPhone you're signed in on."
          >
            <Row
              icon="calendar"
              title="Weekly summary"
              subtitle="Monday morning: last week at a glance."
              trailing={
                <Switch
                  value={weeklyOn}
                  disabled={!ready || !prefs}
                  onValueChange={(on) =>
                    void togglePreference("weeklySummary", on)
                  }
                />
              }
            />
            <Row
              icon="flame"
              title="Streak reminder"
              subtitle="When yesterday is logged and today isn't yet."
              separator={streakOn}
              trailing={
                <Switch
                  value={streakOn}
                  disabled={!ready || !prefs}
                  onValueChange={(on) =>
                    void togglePreference("streakNudge", on)
                  }
                />
              }
            />
            {streakOn && prefs ? (
              <MenuRow
                title="At"
                value={prefs.streakNudgeHour}
                options={HOURS}
                separator={false}
                onChange={(hour) => patchPreferences({ streakNudgeHour: hour })}
              />
            ) : null}
          </Section>
        ) : null}
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  weekdays: {
    paddingVertical: spacing.md,
  },
});
