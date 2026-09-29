import * as Notifications from "expo-notifications";
import { ensureReminderChannel } from "./channel";

export type NotificationPermission = "granted" | "denied" | "undetermined";

function readPermission(
  status: Notifications.NotificationPermissionsStatus,
): NotificationPermission {
  const ios = status.ios?.status;
  if (
    status.granted ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return "granted";
  }
  return status.canAskAgain ? "undetermined" : "denied";
}

export async function notificationPermission(): Promise<NotificationPermission> {
  return readPermission(await Notifications.getPermissionsAsync());
}

/** Asks once; after a refusal iOS only lets Settings change the answer. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  const current = readPermission(await Notifications.getPermissionsAsync());
  if (current !== "undetermined") return current;
  await ensureReminderChannel();
  return readPermission(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    }),
  );
}
