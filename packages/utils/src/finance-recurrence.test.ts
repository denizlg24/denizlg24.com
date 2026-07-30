import { describe, expect, test } from "bun:test";
import {
  describeRecurrence,
  monthlyOccurrenceRate,
  nextRecurringOccurrences,
  recurringOccurrences,
} from "./finance-recurrence";

describe("recurringOccurrences", () => {
  test("every N days", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-08-01",
          recurrence: { cadence: "daily", interval: 10 },
        },
        "2026-08-01",
        "2026-09-01",
      ),
    ).toEqual(["2026-08-01", "2026-08-11", "2026-08-21", "2026-08-31"]);
  });

  test("bi-weekly is weekly at interval 2", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-08-03",
          recurrence: { cadence: "weekly", interval: 2, weekday: 1 },
        },
        "2026-08-01",
        "2026-09-30",
      ),
    ).toEqual([
      "2026-08-03",
      "2026-08-17",
      "2026-08-31",
      "2026-09-14",
      "2026-09-28",
    ]);
  });

  test("weekly realigns onto the configured weekday, not the anchor's", () => {
    // Anchor is a Monday; the rule asks for Thursday (4).
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-08-03",
          recurrence: { cadence: "weekly", interval: 1, weekday: 4 },
        },
        "2026-08-01",
        "2026-08-31",
      ),
    ).toEqual(["2026-08-06", "2026-08-13", "2026-08-20", "2026-08-27"]);
  });

  test("semi-monthly fires twice a month", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-08-01",
          recurrence: { cadence: "semiMonthly", firstDay: 1, secondDay: 15 },
        },
        "2026-08-01",
        "2026-09-30",
      ),
    ).toEqual(["2026-08-01", "2026-08-15", "2026-09-01", "2026-09-15"]);
  });

  test("semi-monthly clamps both days into February without duplicating", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2027-02-01",
          recurrence: { cadence: "semiMonthly", firstDay: 30, secondDay: 31 },
        },
        "2027-02-01",
        "2027-02-28",
      ),
    ).toEqual(["2027-02-28"]);
  });

  test("every N months clamps a 31st onto shorter months", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-01-31",
          recurrence: { cadence: "monthly", interval: 1, dayOfMonth: 31 },
        },
        "2026-01-01",
        "2026-05-01",
      ),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  test("quarterly is monthly at interval 3", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-01-15",
          recurrence: { cadence: "monthly", interval: 3, dayOfMonth: 15 },
        },
        "2026-01-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
  });

  test("yearly repeats on the configured month and day", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-01-01",
          recurrence: {
            cadence: "yearly",
            interval: 1,
            month: 3,
            dayOfMonth: 15,
          },
        },
        "2026-01-01",
        "2028-12-31",
      ),
    ).toEqual(["2026-03-15", "2027-03-15", "2028-03-15"]);
  });

  test("yearly clamps Feb 29 onto non-leap years", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2028-02-29",
          recurrence: {
            cadence: "yearly",
            interval: 1,
            month: 2,
            dayOfMonth: 29,
          },
        },
        "2028-01-01",
        "2030-12-31",
      ),
    ).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
  });

  test("endDate stops the series", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-08-01",
          recurrence: { cadence: "monthly", interval: 1, dayOfMonth: 1 },
          endDate: "2026-10-01",
        },
        "2026-08-01",
        "2027-01-01",
      ),
    ).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  test("occurrences before the window are skipped", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "2026-01-01",
          recurrence: { cadence: "monthly", interval: 1, dayOfMonth: 1 },
        },
        "2026-06-01",
        "2026-08-01",
      ),
    ).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });

  test("an invalid anchor yields nothing rather than looping", () => {
    expect(
      recurringOccurrences(
        {
          anchorDate: "not-a-date",
          recurrence: { cadence: "daily", interval: 1 },
        },
        "2026-01-01",
        "2026-01-05",
      ),
    ).toEqual([]);
  });
});

describe("nextRecurringOccurrences", () => {
  test("returns the requested count from the given date", () => {
    expect(
      nextRecurringOccurrences(
        {
          anchorDate: "2026-01-01",
          recurrence: { cadence: "weekly", interval: 2, weekday: 4 },
        },
        "2026-08-01",
        3,
      ),
    ).toHaveLength(3);
  });

  test("stops early at endDate", () => {
    expect(
      nextRecurringOccurrences(
        {
          anchorDate: "2026-08-01",
          recurrence: { cadence: "monthly", interval: 1, dayOfMonth: 1 },
          endDate: "2026-09-01",
        },
        "2026-08-01",
        5,
      ),
    ).toEqual(["2026-08-01", "2026-09-01"]);
  });
});

describe("describeRecurrence", () => {
  test.each([
    [{ cadence: "daily", interval: 1 } as const, "every day"],
    [{ cadence: "daily", interval: 10 } as const, "every 10 days"],
    [{ cadence: "weekly", interval: 1, weekday: 2 } as const, "every Tuesday"],
    [
      { cadence: "weekly", interval: 2, weekday: 0 } as const,
      "every 2 weeks on Sunday",
    ],
    [
      { cadence: "semiMonthly", firstDay: 1, secondDay: 15 } as const,
      "the 1st and 15th of each month",
    ],
    [
      { cadence: "monthly", interval: 1, dayOfMonth: 3 } as const,
      "day 3 of each month",
    ],
    [
      { cadence: "monthly", interval: 3, dayOfMonth: 3 } as const,
      "day 3 every 3 months",
    ],
    [
      { cadence: "yearly", interval: 1, month: 3, dayOfMonth: 22 } as const,
      "22 March each year",
    ],
  ])("%o reads as %s", (recurrence, expected) => {
    expect(describeRecurrence(recurrence)).toBe(expected);
  });
});

describe("monthlyOccurrenceRate", () => {
  test("semi-monthly counts twice a month", () => {
    expect(
      monthlyOccurrenceRate({
        cadence: "semiMonthly",
        firstDay: 1,
        secondDay: 15,
      }),
    ).toBe(2);
  });

  test("quarterly is a third of a month", () => {
    expect(
      monthlyOccurrenceRate({
        cadence: "monthly",
        interval: 3,
        dayOfMonth: 1,
      }),
    ).toBeCloseTo(1 / 3, 10);
  });

  test("bi-weekly is just over two a month", () => {
    expect(
      monthlyOccurrenceRate({ cadence: "weekly", interval: 2, weekday: 1 }),
    ).toBeCloseTo(2.174, 3);
  });
});
