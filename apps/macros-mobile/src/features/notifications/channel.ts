import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const REMINDER_CHANNEL_ID = "reminders";

/**
 * Android files every notification under a channel, and from Android 13 it
 * will not even ask for permission until one exists. A no-op elsewhere, and
 * idempotent: creating an existing channel only renames it.
 */
export async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "Reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}
