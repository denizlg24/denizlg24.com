import type { MacrosBodyOverview } from "@repo/schemas/macros";

type Reading = MacrosBodyOverview["activity"][number];
export type ActivityMetric = "steps" | "activeEnergyKcal";
export interface ActivityDay {
  date: string;
  steps: number | null;
  activeEnergyKcal: number | null;
  stepsSource: Reading["source"] | null;
  energySource: Reading["source"] | null;
}

/** Daily totals from multiple sources overlap. Manual values override each
 * metric separately; never add Health/Shortcuts and manual totals together. */
export function activityOn(
  readings: readonly Reading[],
  date: string,
): ActivityDay {
  const rows = readings
    .filter((row) => row.logDate === date)
    .sort(
      (a, b) =>
        Number(b.source === "manual") - Number(a.source === "manual") ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const value = (metric: ActivityMetric) =>
    rows.find((row) => row[metric] !== null && Number.isFinite(row[metric]));
  const steps = value("steps");
  const energy = value("activeEnergyKcal");
  return {
    date,
    steps: steps?.steps ?? null,
    activeEnergyKcal: energy?.activeEnergyKcal ?? null,
    stepsSource: steps?.source ?? null,
    energySource: energy?.source ?? null,
  };
}

/** Calendar days, retaining null for missing data rather than inventing zero. */
export function activityDays(
  readings: readonly Reading[],
  end: string,
  count: number,
): ActivityDay[] {
  const endTime = new Date(`${end}T12:00:00Z`).getTime();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(endTime - (count - index - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    return activityOn(readings, date);
  });
}

export function activityAverage(
  days: readonly ActivityDay[],
  metric: ActivityMetric,
): number | null {
  const values = days.flatMap((day) =>
    day[metric] === null ? [] : [day[metric]],
  );
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}
