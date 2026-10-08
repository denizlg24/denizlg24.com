import type { WorkHoursOverview } from "@repo/schemas";
import * as Notifications from "expo-notifications";
import { type PlannedReminder, planReminders } from "./plan";
import { getReminderSettings } from "./settings";

const PREFIX = "hours.";

/** Notification actions; handled in `HoursSync`. */
export const CATEGORY_ACTIONS = {
  shift: [
    { identifier: "out", buttonTitle: "Check out" },
    { identifier: "break", buttonTitle: "Break" },
  ],
  break: [
    { identifier: "resume", buttonTitle: "Resume" },
    { identifier: "out", buttonTitle: "Check out" },
  ],
} as const;

export async function registerCategories() {
  for (const [category, actions] of Object.entries(CATEGORY_ACTIONS)) {
    await Notifications.setNotificationCategoryAsync(
      category,
      actions.map((action) => ({
        identifier: action.identifier,
        buttonTitle: action.buttonTitle,
        options: { opensAppToForeground: true },
      })),
    );
  }
}

export async function requestPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) return current.granted;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return asked.granted;
}

function content(
  reminder: PlannedReminder,
): Notifications.NotificationContentInput {
  return {
    title: reminder.title,
    body: reminder.body,
    sound: reminder.timeSensitive ? "default" : undefined,
    interruptionLevel: reminder.timeSensitive ? "timeSensitive" : "active",
    ...(reminder.category ? { categoryIdentifier: reminder.category } : {}),
    data: { reminder: reminder.id },
  };
}

/** Replaces every scheduled reminder with what the overview implies now. */
export async function scheduleReminders(overview: WorkHoursOverview | null) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((row) => row.identifier.startsWith(PREFIX))
      .map((row) =>
        Notifications.cancelScheduledNotificationAsync(row.identifier),
      ),
  );
  if (!overview) return;
  const plan = planReminders(overview, getReminderSettings());
  await Promise.all(
    plan.map((reminder) =>
      Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${reminder.id}`,
        content: content(reminder),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.at,
        },
      }),
    ),
  );
}
