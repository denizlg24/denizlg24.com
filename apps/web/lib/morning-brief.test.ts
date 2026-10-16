import { describe, expect, test } from "bun:test";
import type { DashboardToday } from "@repo/schemas";
import { briefLine } from "./morning-brief";

const base: DashboardToday = {
  generatedAt: "2026-10-16T05:00:00.000Z",
  day: "2026-10-16",
  timeZone: "Europe/Copenhagen",
  agenda: [],
  counts: {
    triage: 0,
    actionNeeded: 0,
    unreadMail: 0,
    newContacts: 0,
    pendingComments: 0,
    budgetAlerts: 0,
  },
  nextDeadline: null,
  budget: null,
  alerts: [],
  resources: [],
  board: { whiteboardId: null, todos: [] },
  now: null,
  shift: null,
  llm: { todayUsd: 0, monthUsd: 0 },
};

describe("briefLine", () => {
  test("an empty day says so", () => {
    expect(briefLine(base)).toBe("Nothing on");
  });

  test("first timed item in the app's zone, today's deadline, open todos", () => {
    const line = briefLine({
      ...base,
      agenda: [
        {
          id: "h",
          kind: "event",
          title: "Holiday",
          start: "2026-10-15T22:00:00.000Z",
          end: null,
          allDay: true,
        },
        {
          id: "c",
          kind: "class",
          title: "Algorithms",
          start: "2026-10-16T07:15:00.000Z",
          end: "2026-10-16T09:00:00.000Z",
          allDay: false,
        },
      ],
      nextDeadline: {
        courseId: "x",
        courseName: "Algorithms",
        title: "Problem set",
        dueAt: "2026-10-16T21:59:00.000Z",
        overdue: false,
      },
      board: {
        whiteboardId: "w",
        todos: [
          { elementId: "l", itemId: "a", text: "x", completed: false },
          { elementId: "l", itemId: "b", text: "y", completed: true },
        ],
      },
    });
    expect(line).toBe(
      "2 on · first 09:15 Algorithms · due: Problem set · 1 on the board",
    );
  });

  test("a deadline late tonight in UTC terms but tomorrow locally is not due today", () => {
    const line = briefLine({
      ...base,
      nextDeadline: {
        courseId: "x",
        courseName: "Algorithms",
        title: "Tomorrow's set",
        dueAt: "2026-10-16T23:30:00.000Z",
        overdue: false,
      },
    });
    expect(line).toBe("Nothing on");
  });
});
