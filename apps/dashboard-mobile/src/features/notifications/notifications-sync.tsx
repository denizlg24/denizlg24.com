import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import {
  AGENDA_DAYS,
  agendaRange,
  useCalendarEvents,
  useSemesterOverview,
  useTimetable,
} from "@/api/calendar";
import { buildAgendaDays } from "@/features/calendar/agenda";
import { useSettings } from "@/lib/settings";
import { planLocalNotifications } from "./local-plan";
import { registerForPush } from "./push";
import { pathFromUrl } from "./routing";
import { notificationsAllowed, scheduleLocal } from "./schedule";

/**
 * Keeps the locally planned notifications in step with the cached agenda and
 * the toggles, and opens the screen a tapped notification points at.
 */
export function NotificationsSync() {
  const router = useRouter();
  const events = useCalendarEvents();
  const timetable = useTimetable();
  const overview = useSemesterOverview();
  const settings = useSettings();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const path = pathFromUrl(response?.notification.request.content.data?.url);
    if (path) router.push(path);
  }, [response, router]);

  useEffect(() => {
    void registerForPush(settings.notifications).catch(() => undefined);
  }, [settings.notifications]);

  useEffect(() => {
    if (!events.data || !timetable.data) return;
    const days = buildAgendaDays({
      events: events.data,
      timetable: timetable.data,
      deadlines: overview.data?.deadlines ?? [],
      from: agendaRange().start,
      days: AGENDA_DAYS,
    });
    const plan = planLocalNotifications({
      days,
      prefs: settings.notifications,
      settings: settings.local,
      now: new Date(),
    });
    void (async () => {
      if (plan.length > 0 && !(await notificationsAllowed(true))) return;
      await scheduleLocal(plan);
    })().catch(() => undefined);
  }, [events.data, timetable.data, overview.data, settings]);

  return null;
}
