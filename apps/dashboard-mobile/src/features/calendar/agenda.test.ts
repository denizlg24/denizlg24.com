import { describe, expect, test } from "bun:test";
import type {
  ICalendarEvent,
  ISemesterDeadline,
  ITimetableEntry,
} from "@repo/schemas";
import { buildAgendaDays } from "./agenda";

const event = (
  id: string,
  date: Date,
  extra: Partial<ICalendarEvent> = {},
): ICalendarEvent => ({
  _id: id,
  date: date.toISOString(),
  calendarDate: "",
  isAllDay: false,
  kind: "manual",
  title: id,
  links: [],
  status: "scheduled",
  notifyBySlack: false,
  isNotificationSent: false,
  notifyBeforeMinutes: 15,
  ...extra,
});

const entry: ITimetableEntry = {
  _id: "algo",
  title: "Algorithms",
  dayOfWeek: 0,
  startTime: "09:15",
  endTime: "11:00",
  links: [],
  color: "accent",
  isActive: true,
  createdAt: "",
  updatedAt: "",
};

const deadline = (
  id: string,
  dueAt: Date,
  extra: Partial<ISemesterDeadline> = {},
): ISemesterDeadline => ({
  _id: id,
  title: id,
  dueAt: dueAt.toISOString(),
  source: "assignment",
  completed: false,
  overdue: false,
  courseId: "c",
  courseName: "Algorithms",
  ...extra,
});

// A Monday.
const from = new Date(2026, 9, 12, 8, 0);

describe("buildAgendaDays", () => {
  test("classes repeat on their weekday, events land on their day, all-day first", () => {
    const days = buildAgendaDays({
      events: [
        event("dentist", new Date(2026, 9, 12, 8, 30)),
        event("holiday", new Date(2026, 9, 12, 12), {
          isAllDay: true,
          calendarDate: "2026-10-12",
        }),
        event("canceled", new Date(2026, 9, 12, 13), { status: "canceled" }),
      ],
      timetable: [entry],
      deadlines: [],
      from,
      days: 8,
    });
    expect(days).toHaveLength(8);
    expect(days[0]?.rows.map((row) => row.key)).toEqual([
      "event:holiday",
      "event:dentist",
      "class:algo:2026-10-12",
    ]);
    expect(days[7]?.rows.map((row) => row.kind)).toEqual(["class"]);
    expect(days[1]?.rows).toEqual([]);
  });

  test("an overdue deadline is kept on the first day; finished ones are dropped", () => {
    const days = buildAgendaDays({
      events: [],
      timetable: [],
      deadlines: [
        deadline("late", new Date(2026, 9, 1), { overdue: true }),
        deadline("done", new Date(2026, 9, 13), { completed: true }),
        deadline("next", new Date(2026, 9, 13, 23, 59)),
      ],
      from,
      days: 3,
    });
    expect(days[0]?.rows.map((row) => row.title)).toEqual(["late"]);
    expect(days[1]?.rows.map((row) => row.title)).toEqual(["next"]);
  });
});
