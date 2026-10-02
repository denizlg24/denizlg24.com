import { describe, expect, test } from "bun:test";
import {
  amountAt,
  cupFills,
  formatCups,
  IMPERIAL_WATER,
  METRIC_WATER,
} from "./water";

describe("amountAt", () => {
  test("snaps to the step and never reads empty", () => {
    expect(amountAt(0.26, METRIC_WATER)).toBe(250);
    expect(amountAt(0.27, METRIC_WATER)).toBe(250);
    expect(amountAt(0.28, METRIC_WATER)).toBe(300);
    expect(amountAt(0, METRIC_WATER)).toBe(50);
    expect(amountAt(1.4, METRIC_WATER)).toBe(1000);
    expect(amountAt(0.5, IMPERIAL_WATER)).toBe(16);
  });
});

describe("formatCups", () => {
  test("rounds to quarters", () => {
    expect(formatCups(1000, METRIC_WATER)).toBe("4 cups");
    expect(formatCups(250, METRIC_WATER)).toBe("1 cup");
    expect(formatCups(330, METRIC_WATER)).toBe("1¼ cups");
    expect(formatCups(500, METRIC_WATER)).toBe("2 cups");
    expect(formatCups(200, METRIC_WATER)).toBe("¾ cup");
    expect(formatCups(20, METRIC_WATER)).toBe("less than ¼ cup");
    expect(formatCups(12, IMPERIAL_WATER)).toBe("1½ cups");
  });
});

describe("cupFills", () => {
  test("fills whole cups and leaves the last partial", () => {
    expect(cupFills(500, METRIC_WATER)).toEqual([1, 1]);
    expect(cupFills(330, METRIC_WATER)).toEqual([1, expect.closeTo(0.32)]);
    expect(cupFills(1000, METRIC_WATER)).toHaveLength(4);
  });
});
