import type { WorkSession } from "@repo/schemas";
import { endOfISOWeek, format, getISOWeek, startOfISOWeek } from "date-fns";
import { combine, localDay } from "@/lib/time";

export interface HistoryWeek {
  key: string;
  label: string;
  range: string;
  minutes: number;
  days: { day: string; sessions: WorkSession[]; minutes: number }[];
}

/** Newest first: weeks of days of shifts, each with its total. */
export function groupHistory(sessions: WorkSession[]): HistoryWeek[] {
  const byDay = new Map<string, WorkSession[]>();
  for (const session of sessions) {
    const list = byDay.get(session.day) ?? [];
    list.push(session);
    byDay.set(session.day, list);
  }
  const weeks = new Map<string, HistoryWeek>();
  for (const [day, rows] of [...byDay.entries()].sort(([a], [b]) =>
    b.localeCompare(a),
  )) {
    rows.sort((a, b) => b.start.localeCompare(a.start));
    const date = combine(day, "12:00");
    const monday = startOfISOWeek(date);
    const key = localDay(monday);
    let week = weeks.get(key);
    if (!week) {
      week = {
        key,
        label: `Week ${getISOWeek(date)}`,
        range: `${format(monday, "d MMM")} – ${format(endOfISOWeek(date), "d MMM")}`,
        minutes: 0,
        days: [],
      };
      weeks.set(key, week);
    }
    const minutes = rows.reduce((sum, row) => sum + row.workedMinutes, 0);
    week.minutes += minutes;
    week.days.push({ day, sessions: rows, minutes });
  }
  return [...weeks.values()];
}
