import { describe, expect, test } from "bun:test";
import {
  clockOfMinutes,
  formatShift,
  minutesOfClock,
  RETIME_STEP_POINTS,
  retimedMinutes,
} from "./retime";

describe("retimedMinutes", () => {
  test("no travel keeps an off-grid time", () => {
    expect(retimedMinutes(8 * 60 + 7, RETIME_STEP_POINTS - 1)).toBe(487);
  });

  test("down is later and snaps to the quarter hour", () => {
    expect(retimedMinutes(8 * 60 + 7, RETIME_STEP_POINTS * 2)).toBe(
      8 * 60 + 30,
    );
  });

  test("up is earlier", () => {
    expect(retimedMinutes(8 * 60, -RETIME_STEP_POINTS * 4)).toBe(7 * 60);
  });

  test("stays on the same day", () => {
    expect(retimedMinutes(60, -RETIME_STEP_POINTS * 100)).toBe(0);
    expect(retimedMinutes(23 * 60, RETIME_STEP_POINTS * 100)).toBe(
      23 * 60 + 45,
    );
  });
});

describe("clocks", () => {
  test("round-trip", () => {
    expect(clockOfMinutes(minutesOfClock("07:45"))).toBe("07:45");
    expect(clockOfMinutes(0)).toBe("00:00");
  });
});

describe("formatShift", () => {
  test("reads as a signed duration", () => {
    expect(formatShift(45)).toBe("+45 min");
    expect(formatShift(-60)).toBe("−1 h");
    expect(formatShift(75)).toBe("+1 h 15 min");
  });
});
