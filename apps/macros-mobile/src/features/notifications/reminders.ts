import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { ensureReminderChannel, REMINDER_CHANNEL_ID } from "./channel";
import { notificationPermission } from "./permissions";
import {
  type PlannedReminder,
  type PlannedTrigger,
  planReminders,
  REMINDER_ID_PREFIX,
  type ReminderSettings,
} from "./reminder-plan";

const CONTENT: Record<
  PlannedReminder["kind"],
  Notifications.NotificationContentInput
> = {
  log: {
    title: "Time to log",
    body: "Add what you've eaten today.",
    sound: "default",
  },
  "weigh-in": {
    title: "Weigh in",
    body: "Step on the scale and log today's weight.",
    sound: "default",
  },
};

const channel =
  Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {};

function toTrigger(
  trigger: PlannedTrigger,
): Notifications.NotificationTriggerInput {
  switch (trigger.type) {
    case "daily":
      return {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: trigger.hour,
        minute: trigger.minute,
        ...channel,
      };
    case "weekly":
      return {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: trigger.weekday,
        hour: trigger.hour,
        minute: trigger.minute,
        ...channel,
      };
    case "date":
      return {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: trigger.date,
        ...channel,
      };
  }
}

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
  loggedToday: boolean,
): Promise<void> {
  return enqueue(async () => {
    await cancelOurs();
    if ((await notificationPermission()) !== "granted") return;
    await ensureReminderChannel();
    const plan = planReminders(settings, { now: new Date(), loggedToday });
    for (const reminder of plan) {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: CONTENT[reminder.kind],
        trigger: toTrigger(reminder.trigger),
      });
    }
  });
}

export function cancelReminders(): Promise<void> {
  return enqueue(cancelOurs);
}
