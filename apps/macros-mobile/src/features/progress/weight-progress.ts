import type {
  MacrosActiveGoal,
  MacrosStatistics,
  MacrosWeightOverview,
  MacrosWeightTrendPoint,
} from "@repo/schemas/macros";
import { format, parseISO, subMonths, subYears } from "date-fns";

export const weightRanges = ["1M", "3M", "6M", "1Y", "All"] as const;
export type WeightRange = (typeof weightRanges)[number];

function rangeStart(today: string, range: WeightRange): string | null {
  const end = parseISO(today);
  const start =
    range === "1M"
      ? subMonths(end, 1)
      : range === "3M"
        ? subMonths(end, 3)
        : range === "6M"
          ? subMonths(end, 6)
          : range === "1Y"
            ? subYears(end, 1)
            : null;
  return start ? format(start, "yyyy-MM-dd") : null;
}

/**
 * The trend series for a range. Before the server has computed a trend (a
 * brand-new account), raw weigh-ins stand in so the chart is never blank.
 */
export function trendForRange(
  overview: MacrosWeightOverview,
  range: WeightRange,
): MacrosWeightTrendPoint[] {
  const start = rangeStart(overview.today, range);
  const inRange = (date: string) =>
    (start === null || date >= start) && date <= overview.today;
  const trend = overview.trend.filter((point) => inRange(point.date));
  if (trend.length > 0) return trend;
  return overview.entries
    .filter((entry) => inRange(entry.logDate))
    .map((entry) => ({
      date: entry.logDate,
      trendWeightKg: entry.weightKg,
      scaleWeightKg: entry.weightKg,
      varianceKg2: 0,
      slopeKgPerWeek: null,
      hasObservation: true,
      algorithmVersion: "uncomputed",
    }))
    .reverse();
}

export interface RangeSummary {
  trendKg: number | null;
  changeKg: number | null;
  slopeKgPerWeek: number | null;
  firstDate: string | null;
}

export function summarizeTrend(points: MacrosWeightTrendPoint[]): RangeSummary {
  const first = points.at(0);
  const last = points.at(-1);
  return {
    trendKg: last?.trendWeightKg ?? null,
    changeKg:
      first && last && points.length >= 2
        ? last.trendWeightKg - first.trendWeightKg
        : null,
    slopeKgPerWeek: last?.slopeKgPerWeek ?? null,
    firstDate: first?.date ?? null,
  };
}

/** The freshest trend weight, falling back to the latest scale reading. */
export function currentWeightKg(
  overview: MacrosWeightOverview | undefined,
): number | null {
  return (
    overview?.trend.at(-1)?.trendWeightKg ??
    overview?.summary.latestWeightKg ??
    null
  );
}

export interface GoalProgress {
  /** 0..1 of the way from start to target; null when the goal has no distance. */
  fraction: number | null;
  /** Signed kg still to go (target − current). */
  remainingKg: number | null;
  reached: boolean;
}

export function goalProgress(
  goal: Pick<MacrosActiveGoal, "goalType" | "startWeightKg" | "targetWeightKg">,
  currentKg: number | null,
): GoalProgress {
  const { startWeightKg: start, targetWeightKg: target } = goal;
  if (target == null || currentKg == null) {
    return { fraction: null, remainingKg: null, reached: false };
  }
  const remainingKg = target - currentKg;
  const reached =
    goal.goalType === "lose"
      ? currentKg <= target
      : goal.goalType === "gain"
        ? currentKg >= target
        : Math.abs(remainingKg) < 0.5;
  if (start == null || start === target) {
    return { fraction: null, remainingKg, reached };
  }
  const fraction = Math.min(
    1,
    Math.max(0, (start - currentKg) / (start - target)),
  );
  return { fraction, remainingKg, reached };
}

export interface ExpenditureSummary {
  latestKcal: number | null;
  lowKcal: number | null;
  highKcal: number | null;
  changeKcal: number | null;
  firstDate: string | null;
  points: Array<{ date: string; tdee: number; low: number; high: number }>;
}

export function summarizeExpenditure(
  statistics: MacrosStatistics | undefined,
): ExpenditureSummary {
  const points = (statistics?.series ?? []).flatMap((point) =>
    point.tdee != null
      ? [
          {
            date: point.date,
            tdee: point.tdee,
            low: point.tdeeLow ?? point.tdee,
            high: point.tdeeHigh ?? point.tdee,
          },
        ]
      : [],
  );
  const first = points.at(0);
  const last = points.at(-1);
  return {
    latestKcal: statistics?.summary.latestTdee ?? last?.tdee ?? null,
    lowKcal: last?.low ?? null,
    highKcal: last?.high ?? null,
    changeKcal:
      first && last && points.length >= 2 ? last.tdee - first.tdee : null,
    firstDate: first?.date ?? null,
    points,
  };
}
