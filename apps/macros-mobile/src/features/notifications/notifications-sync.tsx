import type { MacrosFoodLogDay } from "@repo/schemas/macros";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { fetchFoodLogDay } from "@/api/food-log";
import { queryKeys } from "@/api/keys";
import { useProfile } from "@/api/profile";
import { isoToday } from "@/lib/day";
import { onFoodLogChanged } from "@/lib/log-events";
import {
  ensureRemotePushRegistered,
  onPushTokenChanged,
  registerForRemotePush,
} from "./push";
import { useReminderSettings } from "./reminder-settings";
import { applyReminders } from "./reminders";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Keeps on-device reminders in step with the food log and this device's
 * push token registered with the server. Renders nothing.
 */
export function NotificationsSync() {
  const queryClient = useQueryClient();
  const timezone = useProfile().data?.timezone;
  const { settings, loaded } = useReminderSettings();

  const loggedToday = useCallback(async () => {
    const today = isoToday(timezone);
    const queryKey = queryKeys.foodLogDay(today);
    try {
      const day = await queryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => fetchFoodLogDay(today, signal),
        staleTime: 0,
      });
      return day.entries.length > 0;
    } catch {
      // Offline: what this phone last knew, optimistic entries included.
      const cached = queryClient.getQueryData<MacrosFoodLogDay>(queryKey);
      return (cached?.entries.length ?? 0) > 0;
    }
  }, [queryClient, timezone]);

  const reschedule = useCallback(async () => {
    if (!loaded || !timezone) return;
    const logged = settings.log.enabled ? await loggedToday() : false;
    await applyReminders(settings, logged);
  }, [loaded, timezone, settings, loggedToday]);

  useEffect(() => {
    void reschedule();
    const unsubscribe = onFoodLogChanged(() => void reschedule());
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") void reschedule();
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [reschedule]);

  useEffect(() => {
    registerForRemotePush().catch(() => undefined);
    const stop = onPushTokenChanged();
    const subscription = AppState.addEventListener("change", (status) => {
      // Permission may have been granted in Settings while we were away.
      if (status === "active") {
        ensureRemotePushRegistered().catch(() => undefined);
      }
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, []);

  return null;
}
