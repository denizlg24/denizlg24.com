import { describe, expect, test } from "bun:test";
import type { AgendaDay } from "@/features/calendar/agenda";
import { planLocalNotifications } from "./local-plan";

const now = new Date(2026, 9, 16, 8, 0);
const at = (hours: number, minutes = 0, day = 16) =>
  new Date(2026, 9, day, hours, minutes);

const days: AgendaDay[] = [
  {
    key: "2026-10-16",
    date: at(0),
    rows: [
      {
        key: "event:a",
        kind: "event",
        title: "Dentist",
        start: at(8, 5),
        end: null,
        allDay: false,
        eventId: "a",
      },
      {
        key: "class:x",
        kind: "class",
        title: "Algorithms",
        start: at(9, 15),
        end: at(11),
        allDay: false,
        place: "Aud. 2",
      },
      {
        key: "event:allday",
        kind: "event",
        title: "Holiday",
        start: null,
        end: null,
        allDay: true,
      },
      {
        key: "due:c:1",
        kind: "due",
        title: "Problem set",
        start: at(9, 0, 17),
        end: null,
        allDay: false,
        courseId: "c",
      },
    ],
  },
];

const settings = { eventLeadMinutes: 10, classLeadMinutes: 15 };

describe("planLocalNotifications", () => {
  test("lead times apply, past reminders drop, coursework gets both", () => {
    const plan = planLocalNotifications({ days, prefs: {}, settings, now });
    expect(
      plan.map((item) => [item.id, item.at.getDate(), item.at.getHours()]),
    ).toEqual([
      ["class:class:x", 16, 9],
      ["due:due:c:1:24", 16, 9],
      ["due:due:c:1:2", 17, 7],
    ]);
    expect(plan[0]).toMatchObject({
      body: "09:15 · Aud. 2",
      level: "active",
    });
  });

  test("a kind that is off plans nothing", () => {
    const plan = planLocalNotifications({
      days,
      prefs: { assignment_due: false, class_starting: false },
      settings,
      now,
    });
    expect(plan).toEqual([]);
  });
});
