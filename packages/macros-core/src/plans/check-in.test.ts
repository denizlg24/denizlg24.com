import { describe, expect, test } from "bun:test";
import { caloriesFromMacros, checkInSchedule } from "./check-in";

// 2026-09-28 is a Monday.
describe("checkInSchedule", () => {
  test("is due on the check-in day when the last one was a week ago", () => {
    expect(
      checkInSchedule({
        today: "2026-09-28",
        checkInWeekday: 1,
        lastCheckInOn: "2026-09-21",
      }),
    ).toEqual({ scheduledOn: "2026-09-28", nextOn: "2026-09-28", due: true });
  });

  test("stays due after a missed check-in day", () => {
    expect(
      checkInSchedule({
        today: "2026-10-01",
        checkInWeekday: 1,
        lastCheckInOn: "2026-09-21",
      }),
    ).toEqual({ scheduledOn: "2026-09-28", nextOn: "2026-09-28", due: true });
  });

  test("points at next week once checked in", () => {
    expect(
      checkInSchedule({
        today: "2026-09-28",
        checkInWeekday: 1,
        lastCheckInOn: "2026-09-28",
      }),
    ).toEqual({ scheduledOn: "2026-09-28", nextOn: "2026-10-05", due: false });
  });

  test("an early check-in covers the coming scheduled day only if on it", () => {
    expect(
      checkInSchedule({
        today: "2026-10-03",
        checkInWeekday: 0,
        lastCheckInOn: "2026-10-02",
      }),
    ).toEqual({ scheduledOn: "2026-09-27", nextOn: "2026-10-04", due: false });
  });

  test("is due without any previous check-in", () => {
    expect(
      checkInSchedule({
        today: "2026-09-29",
        checkInWeekday: 1,
        lastCheckInOn: null,
      }).due,
    ).toBe(true);
  });
});

test("caloriesFromMacros", () => {
  expect(
    caloriesFromMacros({ proteinGrams: 150, carbsGrams: 200, fatGrams: 70 }),
  ).toBe(2030);
});
