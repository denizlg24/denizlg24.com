import {
  DASHBOARD_NOTIFICATIONS,
  type DashboardLocalNotificationSettings,
  type DashboardNotificationKind,
  type DashboardNotificationPrefs,
  type NotificationLevel,
  notificationEnabled,
} from "@repo/schemas";
import type { AgendaDay } from "@/features/calendar/agenda";
import { clock } from "@/lib/format";

export interface PlannedNotification {
  id: string;
  kind: DashboardNotificationKind;
  at: Date;
  title: string;
  body: string;
  level: NotificationLevel;
  url: string;
}

/** iOS keeps 64 pending per app; the rest of the budget stays free. */
const MAX_PLANNED = 56;
const HOUR = 3_600_000;

/**
 * Everything the phone notifies about by itself, from the cached agenda:
 * an event or a class about to start, and coursework due in a day and in two
 * hours. Nothing in the past and nothing for a kind that is off.
 */
export function planLocalNotifications({
  days,
  prefs,
  settings,
  now,
}: {
  days: AgendaDay[];
  prefs: DashboardNotificationPrefs;
  settings: DashboardLocalNotificationSettings;
  now: Date;
}): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const add = (
    kind: DashboardNotificationKind,
    id: string,
    at: Date,
    title: string,
    body: string,
    url: string,
  ) => {
    if (at.getTime() <= now.getTime() || !notificationEnabled(prefs, kind)) {
      return;
    }
    out.push({
      id,
      kind,
      at,
      title,
      body,
      url,
      level: DASHBOARD_NOTIFICATIONS[kind].level,
    });
  };

  for (const day of days) {
    for (const row of day.rows) {
      if (!row.start) continue;
      const where = row.place ? ` · ${row.place}` : "";
      if (row.kind === "event") {
        add(
          "event_starting",
          `event:${row.key}`,
          new Date(row.start.getTime() - settings.eventLeadMinutes * 60_000),
          row.title,
          `${clock(row.start)}${where}`,
          `dashboard://event?id=${row.eventId}`,
        );
      } else if (row.kind === "class") {
        add(
          "class_starting",
          `class:${row.key}`,
          new Date(row.start.getTime() - settings.classLeadMinutes * 60_000),
          row.title,
          `${clock(row.start)}${where}`,
          "dashboard://calendar",
        );
      } else if (!row.overdue) {
        for (const [lead, label] of [
          [24, "Due tomorrow"],
          [2, "Due in 2 h"],
        ] as const) {
          add(
            "assignment_due",
            `due:${row.key}:${lead}`,
            new Date(row.start.getTime() - lead * HOUR),
            row.title,
            `${label}${row.detail ? ` · ${row.detail}` : ""}`,
            `dashboard://calendar/course/${row.courseId}`,
          );
        }
      }
    }
  }
  return out
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_PLANNED);
}
