import { describe, expect, test } from "bun:test";
import { adherenceRule, isOnTarget, summarizeAdherence } from "./adherence";

describe("adherenceRule", () => {
  test("a cut's target is a ceiling and a bulk's a floor", () => {
    expect(adherenceRule("lose")).toBe("at-most");
    expect(adherenceRule("gain")).toBe("at-least");
    expect(adherenceRule("maintain")).toBe("within");
    expect(adherenceRule(null)).toBe("within");
  });
});

describe("isOnTarget", () => {
  test("at-most accepts anything up to 10% over", () => {
    expect(isOnTarget(1700, 2500, "at-most")).toBe(true);
    expect(isOnTarget(2750, 2500, "at-most")).toBe(true);
    expect(isOnTarget(2751, 2500, "at-most")).toBe(false);
  });

  test("at-least accepts anything down to 10% under", () => {
    expect(isOnTarget(3400, 2500, "at-least")).toBe(true);
    expect(isOnTarget(2250, 2500, "at-least")).toBe(true);
    expect(isOnTarget(2249, 2500, "at-least")).toBe(false);
  });

  test("within is a band either side", () => {
    expect(isOnTarget(2250, 2500, "within")).toBe(true);
    expect(isOnTarget(2750, 2500, "within")).toBe(true);
    expect(isOnTarget(1700, 2500, "within")).toBe(false);
    expect(isOnTarget(2800, 2500, "within")).toBe(false);
  });
});

describe("summarizeAdherence", () => {
  test("partial days are neither hits nor misses", () => {
    const days = [1970, 73, 1746, 89, 2020, 500, 2900];
    expect(summarizeAdherence(days, 2500, 1072, "at-most")).toEqual({
      daysTracked: 4,
      daysOnTarget: 3,
    });
    expect(summarizeAdherence(days, 2500, 1072, "within")).toEqual({
      daysTracked: 4,
      daysOnTarget: 0,
    });
  });

  test("no full days tracks nothing", () => {
    expect(summarizeAdherence([90, 300], 2500, 1072, "at-most")).toEqual({
      daysTracked: 0,
      daysOnTarget: 0,
    });
  });
});
