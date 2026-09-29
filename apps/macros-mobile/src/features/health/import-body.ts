import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

/** How far back the first sync reaches: enough history to seed a trend. */
export const FIRST_SYNC_DAYS = 30;

type ActivityDay = { date: string; steps?: number; activeEnergyKcal?: number };
type BodyDay = { date: string; weightKg: number; bodyFatPct?: number };

function shift(isoDate: string, days: number) {
  return format(addDays(parseISO(isoDate), days), "yyyy-MM-dd");
}

/**
 * Re-reads the last imported day as well: its steps and active energy were
 * still growing when it was sent. Never reaches back further than a first
 * sync would, however long the app sat unopened.
 */
export function importWindow(today: string, importedThrough: string | null) {
  const earliest = shift(today, -(FIRST_SYNC_DAYS - 1));
  if (!importedThrough) return { start: earliest, end: today };
  const resume = importedThrough > today ? today : importedThrough;
  const start =
    differenceInCalendarDays(parseISO(today), parseISO(resume)) >=
    FIRST_SYNC_DAYS
      ? earliest
      : resume;
  return { start, end: today };
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The server validates every row and refuses the whole import over one bad
 * value, so anything outside its bounds is dropped here instead. A manually
 * entered 0 kg sample in Health must not block weeks of steps.
 */
export function buildImportBody(body: BodyDay[], activity: ActivityDay[]) {
  return {
    weighIns: body
      .filter((day) => day.weightKg > 0 && day.weightKg <= 500)
      .map((day) => ({
        logDate: day.date,
        weightKg: round(day.weightKg, 3),
        bodyFatPct:
          day.bodyFatPct !== undefined &&
          day.bodyFatPct > 0 &&
          day.bodyFatPct <= 75
            ? round(day.bodyFatPct, 2)
            : null,
      })),
    activity: activity.map((day) => ({
      logDate: day.date,
      steps:
        day.steps !== undefined && day.steps >= 0 && day.steps <= 200_000
          ? day.steps
          : null,
      activeEnergyKcal:
        day.activeEnergyKcal !== undefined &&
        day.activeEnergyKcal >= 0 &&
        day.activeEnergyKcal <= 10_000
          ? round(day.activeEnergyKcal, 2)
          : null,
      sourceId: "healthkit",
    })),
  };
}
