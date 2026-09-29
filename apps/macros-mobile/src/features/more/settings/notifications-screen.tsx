import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, StyleSheet, Switch, View } from "react-native";
import {
  type UpdateNotificationPreferencesInput,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/api/notifications";
import {
  type NotificationPermission,
  notificationPermission,
  requestNotificationPermission,
} from "@/features/notifications/permissions";
import { registerForRemotePush } from "@/features/notifications/push";
import type { ReminderSettings } from "@/features/notifications/reminder-plan";
import {
  updateReminderSettings,
  useReminderSettings,
} from "@/features/notifications/reminder-settings";
import { MenuRow, WeekdayToggles } from "@/features/progress/controls";
import { planWeekdayNames } from "@/features/progress/labels";
import { errorMessage, NetworkError } from "@/lib/api";
import { capabilities, DEVICE_NAME } from "@/lib/config";
import { haptics } from "@/lib/haptics";
import { formatHour } from "@/lib/log-time";
import { Row, Screen, Section, spacing, VStack } from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";
import { type Notice, NoticeSlot, useNotice } from "../shared/notice";

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: formatHour(hour),
}));

function timeValue(hour: number, minute: number): Date {
  return new Date(2000, 0, 1, hour, minute);
}

function usePermission() {
  const [permission, setPermission] = useState<NotificationPermission | null>(
    null,
  );

  const refresh = useCallback(() => {
    notificationPermission()
      .then(setPermission)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    // Coming back from Settings is how a refusal gets undone.
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  /** Asks the first time; resolves whether notifications can be shown. */
  const ensure = useCallback(async () => {
    const next = await requestNotificationPermission().catch(
      (): NotificationPermission => "denied",
    );
    setPermission(next);
    if (next === "granted") registerForRemotePush().catch(() => undefined);
    return next === "granted";
  }, []);

  return { permission, ensure };
}

function TimeRow({
  hour,
  minute,
  onChange,
  separator = true,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  separator?: boolean;
}) {
  return (
    <Row
      title="Time"
      separator={separator}
      trailing={
        <DateTimePicker
          value={timeValue(hour, minute)}
          mode="time"
          display="compact"
          onValueChange={(_event, date) => {
            haptics.selection();
            onChange(date.getHours(), date.getMinutes());
          }}
        />
      }
    />
  );
}

export function NotificationsScreen() {
  const { permission, ensure } = usePermission();
  const reminders = useReminderSettings();
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
          footer={`Set on this ${DEVICE_NAME}. The log reminder skips days you've already logged.`}
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
            <TimeRow
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
              <TimeRow
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
