import type {
  ICalendarEvent,
  ISemesterDeadline,
  ITimetableEntry,
} from "@repo/schemas";
import { isoDay } from "@/lib/format";

export interface AgendaRow {
  key: string;
  kind: "event" | "class" | "due";
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  place?: string;
  detail?: string;
  eventId?: string;
  courseId?: string;
  overdue?: boolean;
}

export interface AgendaDay {
  key: string;
  date: Date;
  rows: AgendaRow[];
}

/** `HH:mm` on a local day. */
export function atTime(day: Date, time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
  );
}

/** Timetable weekdays run Monday = 0. */
export function timetableDay(date: Date) {
  return (date.getDay() + 6) % 7;
}

function sortRows(rows: AgendaRow[]) {
  return rows.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0),
  );
}

/**
 * Events, the week's classes repeated onto each day, and coursework due,
 * as one list per day from `from` for `days` days. Canceled events and
 * finished deadlines are left out; a deadline already past shows on the
 * first day so it is not lost off the top.
 */
export function buildAgendaDays({
  events,
  timetable,
  deadlines,
  from,
  days,
}: {
  events: ICalendarEvent[];
  timetable: ITimetableEntry[];
  deadlines: ISemesterDeadline[];
  from: Date;
  days: number;
}): AgendaDay[] {
  const out: AgendaDay[] = [];
  const byKey = new Map<string, AgendaDay>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + offset,
    );
    const day: AgendaDay = { key: isoDay(date), date, rows: [] };
    out.push(day);
    byKey.set(day.key, day);
    for (const entry of timetable) {
      if (!entry.isActive || entry.dayOfWeek !== timetableDay(date)) continue;
      day.rows.push({
        key: `class:${entry._id}:${day.key}`,
        kind: "class",
        title: entry.title,
        start: atTime(date, entry.startTime),
        end: atTime(date, entry.endTime),
        allDay: false,
        place: entry.place,
      });
    }
  }

  for (const event of events) {
    if (event.status === "canceled") continue;
    const key = event.isAllDay
      ? event.calendarDate
      : isoDay(new Date(event.date));
    const day = byKey.get(key);
    if (!day) continue;
    day.rows.push({
      key: `event:${event._id}`,
      kind: "event",
      title: event.title,
      start: event.isAllDay ? null : new Date(event.date),
      end: event.endDate && !event.isAllDay ? new Date(event.endDate) : null,
      allDay: event.isAllDay,
      place: event.place,
      eventId: event._id,
    });
  }

  const first = out[0];
  for (const deadline of deadlines) {
    if (deadline.completed) continue;
    const due = new Date(deadline.dueAt);
    const day =
      byKey.get(isoDay(due)) ?? (deadline.overdue ? first : undefined);
    if (!day) continue;
    day.rows.push({
      key: `due:${deadline.courseId}:${deadline._id}`,
      kind: "due",
      title: deadline.title,
      start: due,
      end: null,
      allDay: false,
      detail: deadline.courseCode ?? deadline.courseName,
      courseId: deadline.courseId,
      overdue: deadline.overdue,
    });
  }

  for (const day of out) sortRows(day.rows);
  return out;
}
