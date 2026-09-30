import type { MacrosDashboard, MacrosFoodLogDay } from "@repo/schemas/macros";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { fetchDashboard } from "@/api/dashboard";
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
import type { ReminderContext, ReminderSettings } from "./reminder-plan";
import { useReminderSettings } from "./reminder-settings";
import { applyReminders, isReminderKind, REMINDER_HREF } from "./reminders";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const RESCHEDULE_DEBOUNCE_MS = 400;

async function loggedOn(queryClient: QueryClient, today: string) {
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
}

async function dashboardFor(queryClient: QueryClient, today: string) {
  const queryKey = queryKeys.dashboard(today);
  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) => fetchDashboard(signal),
      staleTime: 30_000,
    });
  } catch {
    // Offline or failing: today's cached dashboard, else the newest one — its
    // habits and ticks are still right, and planning without them would cancel
    // every habit reminder.
    const cached = queryClient.getQueryData<MacrosDashboard>(queryKey);
    if (cached) return cached;
    let newest: { data: MacrosDashboard; at: number } | undefined;
    for (const [key, data] of queryClient.getQueriesData<MacrosDashboard>({
      queryKey: ["dashboard"],
    })) {
      const at = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
      if (data && (!newest || at > newest.at)) newest = { data, at };
    }
    return newest?.data;
  }
}

async function reminderContext(
  queryClient: QueryClient,
  settings: ReminderSettings,
  today: string,
): Promise<ReminderContext | null> {
  const wantsHabits = Object.values(settings.habits).some(
    (reminder) => reminder.enabled,
  );
  const [loggedToday, dashboard] = await Promise.all([
    settings.log.enabled ? loggedOn(queryClient, today) : false,
    settings.weighIn.enabled || wantsHabits
      ? dashboardFor(queryClient, today)
      : undefined,
  ]);
  const needsDashboard = settings.weighIn.enabled || wantsHabits;
  // Nothing to plan habits from: leave the scheduled reminders as they are.
  if (needsDashboard && !dashboard) return null;
  return {
    now: new Date(),
    today,
    loggedToday,
    weighedInToday: dashboard?.weightSummary.latestLogDate === today,
    habits: dashboard?.habits ?? [],
  };
}

function openReminder(response: Notifications.NotificationResponse | null) {
  const kind = response?.notification.request.content.data?.reminder;
  if (!isReminderKind(kind)) return;
  if (kind === "habit") router.navigate(REMINDER_HREF[kind]);
  else router.push(REMINDER_HREF[kind]);
}

/**
 * Keeps on-device reminders in step with the day — what is logged, weighed
 * and ticked — and this device's push token registered with the server.
 * Opens the screen a tapped reminder is about. Renders nothing.
 */
export function NotificationsSync() {
  const queryClient = useQueryClient();
  const timezone = useProfile().data?.timezone;
  const { settings, loaded } = useReminderSettings();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const reschedule = useCallback(async () => {
    if (!loaded || !timezone) return;
    const run = ++generation.current;
    const today = isoToday(timezone);
    const context = await reminderContext(queryClient, settings, today);
    // A newer run started while this one fetched; its settings win.
    if (!context || run !== generation.current) return;
    await applyReminders(settings, context);
  }, [loaded, timezone, settings, queryClient]);

  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void reschedule(), RESCHEDULE_DEBOUNCE_MS);
  }, [reschedule]);

  useEffect(() => {
    void reschedule();
    const unsubscribe = onFoodLogChanged(soon);
    // A weigh-in or a habit tick lands in the dashboard, optimistically for a
    // tick, so the plan follows it without either knowing about reminders.
    const unwatch = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryKey[0] !== "dashboard") {
        return;
      }
      if (event.action.type === "success") soon();
    });
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") void reschedule();
    });
    return () => {
      unsubscribe();
      unwatch();
      subscription.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reschedule, soon, queryClient]);

  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        openReminder(response);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => undefined);
    const subscription =
      Notifications.addNotificationResponseReceivedListener(openReminder);
    return () => subscription.remove();
  }, []);

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
