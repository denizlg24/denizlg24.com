import { expect, test } from "bun:test";
import type { MacrosBodyOverview } from "@repo/schemas/macros";
import { activityAverage, activityDays, activityOn } from "./activity";

type Reading = MacrosBodyOverview["activity"][number];
function reading(values: Partial<Reading>): Reading {
  return {
    userId: "test",
    logDate: "2026-10-21",
    steps: null,
    activeEnergyKcal: null,
    source: "import",
    sourceId: "healthkit",
    createdAt: "2026-10-21T08:00:00Z",
    updatedAt: "2026-10-21T08:00:00Z",
    ...values,
  };
}

test("manual values override imported totals per metric without summing overlapping daily totals", () => {
  const day = activityOn(
    [
      reading({ steps: 8000, activeEnergyKcal: 250 }),
      reading({ source: "manual", steps: null, activeEnergyKcal: 300 }),
    ],
    "2026-10-21",
  );
  expect(day.steps).toBe(8000);
  expect(day.stepsSource).toBe("import");
  expect(day.activeEnergyKcal).toBe(300);
  expect(day.energySource).toBe("manual");
});
test("zero is a reading and missing data remains missing", () => {
  const day = activityOn(
    [reading({ steps: 8000 }), reading({ source: "manual", steps: 0 })],
    "2026-10-21",
  );
  expect(day.steps).toBe(0);
  expect(day.activeEnergyKcal).toBeNull();
  expect(activityOn([reading({ steps: 8000 })], "2026-10-20").steps).toBeNull();
});
test("calendar range crosses a year boundary and averages only known days, including zero", () => {
  const days = activityDays(
    [
      reading({ logDate: "2025-12-31", steps: 0 }),
      reading({ logDate: "2026-01-02", steps: 10000 }),
    ],
    "2026-01-02",
    3,
  );
  expect(days.map((day) => day.date)).toEqual([
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
  ]);
  expect(days[1]?.steps).toBeNull();
  expect(activityAverage(days, "steps")).toBe(5000);
  expect(activityAverage(days, "activeEnergyKcal")).toBeNull();
});
test("latest reading wins within a source and readings outside the range do not enter the average", () => {
  const days = activityDays(
    [
      reading({ steps: 1000 }),
      reading({ steps: 2000, updatedAt: "2026-10-21T09:00:00Z" }),
      reading({ logDate: "2026-10-22", steps: 99999 }),
    ],
    "2026-10-21",
    1,
  );
  expect(days[0]?.steps).toBe(2000);
  expect(activityAverage(days, "steps")).toBe(2000);
});
