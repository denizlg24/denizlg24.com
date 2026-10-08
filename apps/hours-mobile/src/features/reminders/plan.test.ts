import { describe, expect, test } from "bun:test";
import type { WorkHoursOverview } from "@repo/schemas";
import { DEFAULT_SETTINGS, planReminders } from "./plan";

const now = new Date("2026-10-08T12:00:00");
const iso = (time: string) => new Date(`2026-10-08T${time}:00`).toISOString();

function overview(partial: Partial<WorkHoursOverview>): WorkHoursOverview {
  return {
    jobs: [
      {
        id: "job",
        name: "Pandora",
        hourlyRateMinor: 15000,
        currency: "DKK",
        breaksPaid: false,
        expectedWeeklyHours: 20,
        timezone: "Europe/Copenhagen",
        status: "active",
        createdAt: iso("00:00"),
        updatedAt: iso("00:00"),
      },
    ],
    active: null,
    today: { workedMinutes: 0, sessionCount: 0 },
    week: { workedMinutes: 0, sessionCount: 0 },
    month: { workedMinutes: 0, sessionCount: 0 },
    recent: [],
    payPeriods: [],
    serverTime: now.toISOString(),
    ...partial,
  };
}

function shift(breaks: { start: string; end?: string }[] = []) {
  return {
    id: "s",
    jobId: "job",
    start: iso("09:00"),
    breaks,
    day: "2026-10-08",
    workedMinutes: 180,
    breakMinutes: 0,
    createdAt: iso("09:00"),
    updatedAt: iso("09:00"),
  };
}

describe("planReminders", () => {
  test("a running shift gets the long-shift, break and week reminders", () => {
    const plan = planReminders(
      overview({
        active: shift(),
        week: { workedMinutes: 1080, sessionCount: 3 },
      }),
      DEFAULT_SETTINGS,
      now,
    );
    const byId = Object.fromEntries(plan.map((row) => [row.id, row]));
    expect(byId["long-shift"]?.at).toEqual(new Date("2026-10-08T19:00:00"));
    expect(byId["break-due"]?.at).toEqual(new Date("2026-10-08T14:30:00"));
    // 1080 − 180 + 180 = 1080 of 1200: two hours to go.
    expect(byId["week-target"]?.at).toEqual(new Date("2026-10-08T14:00:00"));
    expect(byId["long-shift"]?.timeSensitive).toBe(true);
  });

  test("no break reminder once a break was taken", () => {
    const plan = planReminders(
      overview({ active: shift([{ start: iso("10:00"), end: iso("10:30") }]) }),
      DEFAULT_SETTINGS,
      now,
    );
    expect(plan.some((row) => row.id === "break-due")).toBe(false);
  });

  test("an open break is reminded to end, nothing else about the shift", () => {
    const plan = planReminders(
      overview({ active: shift([{ start: iso("11:50") }]) }),
      DEFAULT_SETTINGS,
      now,
    );
    expect(plan.map((row) => row.id)).toEqual(["break-over"]);
    expect(plan[0]?.at).toEqual(new Date("2026-10-08T12:20:00"));
  });

  test("payday at nine, never in the past", () => {
    const period = {
      ruleId: "rule",
      ruleName: "Pandora",
      jobId: "job",
      periodStart: "2026-09-21",
      periodEnd: "2026-10-20",
      partial: false,
      loggedMinutes: 0,
      projectedMinutes: 0,
      grossMinor: 0,
      netMinor: 1234500,
      lines: [],
      currency: "DKK",
    };
    const plan = planReminders(
      overview({
        payPeriods: [
          { ...period, payoutDate: "2026-10-31" },
          { ...period, ruleId: "old", payoutDate: "2026-10-08" },
        ],
      }),
      DEFAULT_SETTINGS,
      now,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]?.at).toEqual(new Date("2026-10-31T09:00:00"));
    expect(plan[0]?.body).toContain("12,345.00");
  });
});
