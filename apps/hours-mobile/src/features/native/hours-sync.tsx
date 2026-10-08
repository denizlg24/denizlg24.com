import { HoursNative } from "@modules/hours-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { hoursKeys, useOverview } from "@/api/hours";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import {
  registerCategories,
  requestPermission,
  scheduleReminders,
} from "../reminders/schedule";
import { useReminderSettings } from "../reminders/settings";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ACTIONS = new Set(["in", "out", "break", "resume"]);

/**
 * Everything outside the screen that follows the overview: the App Group copy
 * the widgets, controls and Live Activity read, the reminders, and the
 * device's Live Activity push tokens on the server.
 */
export function HoursSync() {
  const overview = useOverview();
  const settings = useReminderSettings();
  const client = useQueryClient();

  useEffect(() => {
    void HoursNative?.registerDevice();
    void (async () => {
      await registerCategories();
      await requestPermission();
    })();
  }, []);

  useEffect(() => {
    if (!overview.data) return;
    void HoursNative?.setOverview(JSON.stringify(overview.data));
  }, [overview.data]);

  useEffect(() => {
    void settings;
    void scheduleReminders(overview.data ?? null).catch(() => undefined);
  }, [overview.data, settings]);

  // A reminder's buttons clock straight from the notification.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const action = response.actionIdentifier;
        if (!ACTIONS.has(action)) return;
        void api
          .request("hours/clock", { method: "POST", body: { action } })
          .then(
            () => haptics.success(),
            () => haptics.error(),
          )
          .finally(() =>
            client.invalidateQueries({ queryKey: hoursKeys.overview }),
          );
      },
    );
    return () => subscription.remove();
  }, [client]);

  return null;
}
