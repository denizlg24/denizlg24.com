import type { TitleType } from "@repo/schemas/stream";
import type { TitleFilters } from "@/lib/title-query";

/**
 * Tune's dials as stops on a band. Each dial maps a stop index to the part
 * of `TitleFilters` it owns, and back, so the bands stay dumb: they only
 * know how many stops they have and which one the needle is on.
 */

/** The nearest stop to a touch `x` across a band `width` wide. */
export function stopAt(x: number, width: number, count: number): number {
  "worklet";
  if (count <= 1 || width <= 0) return 0;
  const fraction = Math.min(1, Math.max(0, x / width));
  return Math.round(fraction * (count - 1));
}

/** Where stop `index` sits, 0–1 across the band. */
export function stopFraction(index: number, count: number): number {
  "worklet";
  return count <= 1 ? 0.5 : index / (count - 1);
}

export const TIME_STOPS = [30, 60, 90, 120, 150, null] as const;
export const TIME_LABELS = ["30m", "1h", "1h30", "2h", "2h30", "Any"];

export function timeIndex(runtimeMax: number | null): number {
  if (runtimeMax === null) return TIME_STOPS.length - 1;
  const index = TIME_STOPS.findIndex(
    (stop) => stop !== null && stop >= runtimeMax,
  );
  return index === -1 ? TIME_STOPS.length - 1 : index;
}

export function timeAt(index: number): Pick<TitleFilters, "runtimeMax"> {
  return { runtimeMax: TIME_STOPS[index] ?? null };
}

/** Light ↔ heavy in tenths; the needle picks a window either side. */
export const MOOD_STOPS = 21;
export const MOOD_WINDOW = 0.35;

export function moodValue(index: number): number {
  return Math.round((index / (MOOD_STOPS - 1)) * 20 - 10) / 10;
}

export function moodAt(
  index: number | null,
): Pick<TitleFilters, "moodMin" | "moodMax"> {
  if (index === null) return { moodMin: null, moodMax: null };
  const centre = moodValue(index);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    moodMin: round(Math.max(-1, centre - MOOD_WINDOW)),
    moodMax: round(Math.min(1, centre + MOOD_WINDOW)),
  };
}

/** The needle for a stored window, or null when mood is open. */
export function moodIndex(
  moodMin: number | null,
  moodMax: number | null,
): number | null {
  if (moodMin === null && moodMax === null) return null;
  const lo = moodMin ?? -1;
  const hi = moodMax ?? 1;
  // A window clamped at an edge is centred a window's width from it.
  const centre =
    lo <= -1 ? hi - MOOD_WINDOW : hi >= 1 ? lo + MOOD_WINDOW : (lo + hi) / 2;
  return Math.min(
    MOOD_STOPS - 1,
    Math.max(0, Math.round(((centre + 1) / 2) * (MOOD_STOPS - 1))),
  );
}

export function moodLabel(index: number | null): string {
  if (index === null) return "Any mood";
  const value = moodValue(index);
  if (value <= -0.6) return "Light and easy";
  if (value <= -0.2) return "On the lighter side";
  if (value < 0.2) return "A bit of both";
  if (value < 0.6) return "Something with weight";
  return "Heavy going";
}

export const ERA_DECADES = [
  1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020,
] as const;

export function eraAt(
  from: number,
  to: number,
): Pick<TitleFilters, "yearFrom" | "yearTo"> {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const last = ERA_DECADES.length - 1;
  if (lo === 0 && hi === last) return { yearFrom: null, yearTo: null };
  return {
    yearFrom: lo === 0 ? null : (ERA_DECADES[lo] ?? null),
    yearTo: hi === last ? null : (ERA_DECADES[hi] ?? 2020) + 9,
  };
}

export function eraIndices(
  yearFrom: number | null,
  yearTo: number | null,
): [number, number] {
  const last = ERA_DECADES.length - 1;
  const index = (year: number) =>
    Math.min(last, Math.max(0, Math.floor((year - 1920) / 10)));
  return [
    yearFrom === null ? 0 : index(yearFrom),
    yearTo === null ? last : index(yearTo),
  ];
}

export function eraLabel(from: number, to: number): string {
  const { yearFrom, yearTo } = eraAt(from, to);
  if (yearFrom === null && yearTo === null) return "Any era";
  if (yearFrom === null)
    return `Up to the ${String(yearTo ?? 0).slice(0, 3)}0s`;
  if (yearTo === null) return `The ${yearFrom}s onwards`;
  return yearTo - yearFrom === 9
    ? `The ${yearFrom}s`
    : `${yearFrom}s – ${yearTo - 9}s`;
}

/** Acclaim: IMDb rating 5–9 in halves; the first stop is "any". */
export const ACCLAIM_STOPS = [null, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9] as const;

export function acclaimIndex(ratingMin: number | null): number {
  if (ratingMin === null) return 0;
  const index = ACCLAIM_STOPS.findIndex(
    (stop) => stop !== null && stop >= ratingMin,
  );
  return index === -1 ? ACCLAIM_STOPS.length - 1 : index;
}

export function acclaimAt(index: number): Pick<TitleFilters, "ratingMin"> {
  return { ratingMin: ACCLAIM_STOPS[index] ?? null };
}

export const KIND_STOPS: readonly (TitleType | null)[] = [
  "movie",
  null,
  "series",
];
export const KIND_LABELS = ["Film", "Either", "Series"];

export function kindIndex(type: TitleType | null): number {
  if (type === "movie") return 0;
  if (type === "series" || type === "miniseries") return 2;
  return 1;
}

export function kindAt(index: number): Pick<TitleFilters, "type"> {
  return { type: KIND_STOPS[index] ?? null };
}

/** "214 match", "1 match", "No matches". */
export function matchCount(total: number | null): string {
  if (total === null) return "";
  if (total === 0) return "No matches";
  return `${total.toLocaleString("en-GB")} match`;
}
