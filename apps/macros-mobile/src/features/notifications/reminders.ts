import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import { Platform } from "react-native";
import { ensureReminderChannel, REMINDER_CHANNEL_ID } from "./channel";
import { notificationPermission } from "./permissions";
import {
  type PlannedReminder,
  planReminders,
  REMINDER_ID_PREFIX,
  type ReminderContext,
  type ReminderSettings,
} from "./reminder-plan";

export type ReminderKind = PlannedReminder["kind"];

/** Where tapping a reminder lands; read by `NotificationsSync`. */
export const REMINDER_HREF: Record<ReminderKind, Href> = {
  log: "/add-food",
  "weigh-in": "/weigh-in",
  habit: "/",
};

export function isReminderKind(value: unknown): value is ReminderKind {
  return typeof value === "string" && Object.hasOwn(REMINDER_HREF, value);
}

function contentFor(
  reminder: PlannedReminder,
): Notifications.NotificationContentInput {
  const data = { reminder: reminder.kind };
  switch (reminder.kind) {
    case "log":
      return {
        title: "Time to log",
        body: "Nothing logged today yet.",
        sound: "default",
        data,
      };
    case "weigh-in":
      return {
        title: "Weigh in",
        body: "Step on the scale and log today's weight.",
        sound: "default",
        data,
      };
    case "habit":
      return {
        title: reminder.name,
        body: "Not ticked off today yet.",
        sound: "default",
        data,
      };
  }
}

const channel =
  Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {};

async function cancelOurs() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.identifier.startsWith(REMINDER_ID_PREFIX))
      .map((request) =>
        Notifications.cancelScheduledNotificationAsync(request.identifier),
      ),
  );
}

// Runs are chained: two overlapping reschedules (a log and a foreground at
// once) would otherwise interleave their cancels and leave both plans behind.
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => undefined);
  return queue;
}

/** Replaces every reminder this app scheduled with the current plan. */
export function applyReminders(
  settings: ReminderSettings,
  context: ReminderContext,
): Promise<void> {
  return enqueue(async () => {
    await cancelOurs();
    if ((await notificationPermission()) !== "granted") return;
    await ensureReminderChannel();
    for (const reminder of planReminders(settings, context)) {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: contentFor(reminder),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.date,
          ...channel,
        },
      });
    }
  });
}

export function cancelReminders(): Promise<void> {
  return enqueue(cancelOurs);
}
