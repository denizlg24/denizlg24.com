import type { NotificationLevel } from "@repo/schemas";
import * as Notifications from "expo-notifications";
import type { PlannedNotification } from "./local-plan";

const PREFIX = "local.";

Notifications.setNotificationHandler({
  // A chat reply is only news when the app was put away; open, the thread
  // already shows it.
  handleNotification: async (notification) => {
    const quiet = notification.request.content.data?.kind === "chat_reply";
    return {
      shouldShowBanner: !quiet,
      shouldShowList: !quiet,
      shouldPlaySound: !quiet,
      shouldSetBadge: false,
    };
  },
});

const LEVEL = {
  passive: "passive",
  active: "active",
  "time-sensitive": "timeSensitive",
} as const satisfies Record<
  NotificationLevel,
  Notifications.NotificationContentInput["interruptionLevel"]
>;

export async function notificationsAllowed(ask: boolean) {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !ask || !current.canAskAgain) return current.granted;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return asked.granted;
}

/** Replaces every locally planned notification with `plan`. */
export async function scheduleLocal(plan: PlannedNotification[]) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((row) => row.identifier.startsWith(PREFIX))
      .map((row) =>
        Notifications.cancelScheduledNotificationAsync(row.identifier),
      ),
  );
  await Promise.all(
    plan.map((item) =>
      Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${item.id}`,
        content: {
          title: item.title,
          body: item.body,
          sound: item.level === "time-sensitive" ? "default" : undefined,
          interruptionLevel: LEVEL[item.level],
          data: { url: item.url, kind: item.kind },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: item.at,
        },
      }),
    ),
  );
}

export async function clearLocal() {
  await scheduleLocal([]);
}
