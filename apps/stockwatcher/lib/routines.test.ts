import { describe, expect, test } from "bun:test";
import type { RoutineSchedule } from "./models";
import {
  describeSchedule,
  isRoutineDue,
  latestSlot,
  nextSlot,
} from "./routines";

const at = (iso: string) => new Date(iso);
const iso = (time: number) => new Date(time).toISOString();

const monthly: RoutineSchedule = {
  frequency: "monthly",
  day: 1,
  hour: 9,
  timeZone: "Europe/Lisbon",
};

describe("latestSlot", () => {
  test("monthly in summer time is 08:00 UTC", () => {
    expect(iso(latestSlot(monthly, at("2026-07-15T12:00:00Z")))).toBe(
      "2026-07-01T08:00:00.000Z",
    );
  });

  test("monthly in winter time is 09:00 UTC", () => {
    expect(iso(latestSlot(monthly, at("2026-12-01T09:30:00Z")))).toBe(
      "2026-12-01T09:00:00.000Z",
    );
  });

  test("before today's hour it is last month's slot", () => {
    expect(iso(latestSlot(monthly, at("2026-12-01T08:59:00Z")))).toBe(
      "2026-11-01T09:00:00.000Z",
    );
  });

  test("weekly finds the last matching weekday", () => {
    const friday: RoutineSchedule = {
      frequency: "weekly",
      day: 5,
      hour: 22,
      timeZone: "UTC",
    };
    // 2026-11-27 is a Friday.
    expect(iso(latestSlot(friday, at("2026-11-30T10:00:00Z")))).toBe(
      "2026-11-27T22:00:00.000Z",
    );
  });

  test("daily wraps to yesterday across the date line", () => {
    const tokyo: RoutineSchedule = {
      frequency: "daily",
      day: 1,
      hour: 7,
      timeZone: "Asia/Tokyo",
    };
    // 21:00 UTC is 06:00 the next day in Tokyo, before the 07:00 slot.
    expect(iso(latestSlot(tokyo, at("2026-11-27T21:00:00Z")))).toBe(
      "2026-11-26T22:00:00.000Z",
    );
  });
});

describe("nextSlot", () => {
  test("is the next month after this month's slot", () => {
    expect(iso(nextSlot(monthly, at("2026-11-01T09:00:00Z")))).toBe(
      "2026-12-01T09:00:00.000Z",
    );
  });
});

describe("isRoutineDue", () => {
  const base = {
    enabled: true,
    schedule: monthly,
    createdAt: "2026-11-27T10:00:00.000Z",
    lastRun: null,
    resumedAt: null,
  };

  test("never fires for a slot before it was created", () => {
    expect(isRoutineDue(base, at("2026-11-30T10:00:00Z"))).toBe(false);
  });

  test("fires once the first slot passes", () => {
    expect(isRoutineDue(base, at("2026-12-01T09:01:00Z"))).toBe(true);
  });

  test("does not fire again for the same slot", () => {
    expect(
      isRoutineDue(
        { ...base, lastRun: "2026-12-01T09:02:00.000Z" },
        at("2026-12-20T09:00:00Z"),
      ),
    ).toBe(false);
  });

  test("resuming skips the slot missed while paused", () => {
    expect(
      isRoutineDue(
        { ...base, resumedAt: "2026-12-03T10:00:00.000Z" },
        at("2026-12-20T09:00:00Z"),
      ),
    ).toBe(false);
  });

  test("paused never fires", () => {
    expect(
      isRoutineDue({ ...base, enabled: false }, at("2026-12-01T09:01:00Z")),
    ).toBe(false);
  });
});

test("describeSchedule", () => {
  expect(describeSchedule(monthly)).toBe(
    "Monthly on the 1st at 09:00 (Europe/Lisbon)",
  );
  expect(
    describeSchedule({
      frequency: "weekly",
      day: 1,
      hour: 18,
      timeZone: "UTC",
    }),
  ).toBe("Every Monday at 18:00 (UTC)");
});
