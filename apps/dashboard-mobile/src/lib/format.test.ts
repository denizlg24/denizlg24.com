import { describe, expect, test } from "bun:test";
import { ago, clock, dayLabel, daysFrom, isoDay, until } from "./format";

const now = new Date(2026, 9, 16, 10, 0);

describe("format", () => {
  test("clock pads local hours and minutes", () => {
    expect(clock(new Date(2026, 0, 1, 9, 5))).toBe("09:05");
  });

  test("days count across midnight, not 24 h spans", () => {
    expect(daysFrom(new Date(2026, 9, 17, 0, 30), now)).toBe(1);
    expect(daysFrom(new Date(2026, 9, 15, 23, 59), now)).toBe(-1);
  });

  test("day labels go relative, weekday, then date", () => {
    expect(dayLabel(new Date(2026, 9, 16, 22), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 17), now)).toBe("Tomorrow");
    expect(dayLabel(new Date(2026, 9, 15), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 20), now)).toBe("Tue");
    expect(dayLabel(new Date(2026, 9, 30), now)).toBe("30 Oct");
  });

  test("until reads forward, then falls back to ago", () => {
    const at = now.getTime();
    expect(until(new Date(at + 40 * 60_000).toISOString(), at)).toBe(
      "in 40 min",
    );
    expect(until(new Date(at + 3 * 3_600_000).toISOString(), at)).toBe(
      "in 3 h",
    );
    expect(until(new Date(at - 5 * 60_000).toISOString(), at)).toBe(
      "5 min ago",
    );
    expect(ago(new Date(at - 10_000).toISOString(), at)).toBe("now");
  });

  test("isoDay is the local calendar day", () => {
    expect(isoDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
