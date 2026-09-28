import { describe, expect, test } from "bun:test";
import { computeWeightTrend } from "./trend";

function dateAt(day: number): string {
  return new Date(Date.UTC(2026, 0, day + 1)).toISOString().slice(0, 10);
}

describe("weight trend", () => {
  test("returns a dense daily series and marks observed days", () => {
    const points = computeWeightTrend(
      [
        { date: "2026-01-01", weightKg: 80 },
        { date: "2026-01-04", weightKg: 79.8 },
      ],
      "2026-01-05",
    );

    expect(points.map((point) => point.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
    ]);
    expect(points.map((point) => point.hasObservation)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
  });

  test("reports raw weight without a slope while bootstrapping", () => {
    const points = computeWeightTrend([
      { date: "2026-01-01", weightKg: 80 },
      { date: "2026-01-02", weightKg: 81 },
      { date: "2026-01-03", weightKg: 79.5 },
      { date: "2026-01-04", weightKg: 80.2 },
    ]);

    expect(points.at(-1)?.trendWeightKg).toBe(80.2);
    expect(points.at(-1)?.slopeKgPerWeek).toBeNull();
  });

  test("tracks a steady weekly loss through realistic scale noise", () => {
    const observations = Array.from({ length: 84 }, (_, day) => ({
      date: dateAt(day),
      weightKg:
        90 -
        (0.5 / 7) * day +
        0.45 * Math.sin(day * 1.7) +
        0.2 * Math.cos(day * 0.43),
    }));
    const points = computeWeightTrend(observations);
    const latest = points.at(-1);

    expect(latest?.trendWeightKg).toBeCloseTo(84.1, 0);
    expect(latest?.slopeKgPerWeek).toBeCloseTo(-0.5, 1);
    expect(latest?.varianceKg2).toBeGreaterThan(0);
  });

  test("winsorizes a single implausible scale reading", () => {
    const baseline = Array.from({ length: 60 }, (_, day) => ({
      date: dateAt(day),
      weightKg: 80 + 0.25 * Math.sin(day),
    }));
    const withOutlier = baseline.map((point, day) =>
      day === 45 ? { ...point, weightKg: 90 } : point,
    );
    const expected = computeWeightTrend(baseline);
    const actual = computeWeightTrend(withOutlier);

    expect(
      Math.abs(
        (actual.at(-1)?.trendWeightKg ?? 0) -
          (expected.at(-1)?.trendWeightKg ?? 0),
      ),
    ).toBeLessThan(0.2);
  });

  test("ignores invalid and future observations beyond the requested end", () => {
    const points = computeWeightTrend(
      [
        { date: "not-a-date", weightKg: 70 },
        { date: "2026-01-01", weightKg: 80 },
        { date: "2026-02-01", weightKg: 10 },
        { date: "2026-01-02", weightKg: Number.NaN },
      ],
      "2026-01-03",
    );

    expect(points).toHaveLength(3);
    expect(points.at(-1)?.trendWeightKg).toBe(80);
  });
});
