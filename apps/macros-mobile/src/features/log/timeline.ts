import type { MacrosFoodLogEntry } from "@repo/schemas/macros";
import { formatInTimeZone } from "date-fns-tz";

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function sumEntries(entries: readonly MacroTotals[]): MacroTotals {
  return entries.reduce<MacroTotals>(
    (total, entry) => ({
      calories: total.calories + entry.calories,
      protein: total.protein + entry.protein,
      carbs: total.carbs + entry.carbs,
      fat: total.fat + entry.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Entries with no recorded time are drawn at noon. */
export function entryHour(
  entry: Pick<MacrosFoodLogEntry, "eatenAt">,
  timeZone: string,
): number {
  return entry.eatenAt
    ? Number(formatInTimeZone(new Date(entry.eatenAt), timeZone, "H"))
    : 12;
}

export interface HourGroup<T = MacrosFoodLogEntry> {
  hour: number;
  entries: T[];
}

/**
 * The day as a timeline: one group per hour something was eaten in, earliest
 * first. Entries keep the order the day came in, which is by time.
 */
export function groupByHour<T extends Pick<MacrosFoodLogEntry, "eatenAt">>(
  entries: readonly T[],
  timeZone: string,
): HourGroup<T>[] {
  const groups = new Map<number, T[]>();
  for (const entry of entries) {
    const hour = entryHour(entry, timeZone);
    const group = groups.get(hour);
    if (group) group.push(entry);
    else groups.set(hour, [entry]);
  }
  return [...groups]
    .sort(([left], [right]) => left - right)
    .map(([hour, grouped]) => ({ hour, entries: grouped }));
}
