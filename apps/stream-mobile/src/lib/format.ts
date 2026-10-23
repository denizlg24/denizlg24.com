import {
  formatRuntime,
  type TitleType,
  titleYears,
} from "@repo/schemas/stream";

export interface TitleFacts {
  /** "8.1", drawn after a filled star. */
  rating: string | null;
  kind: string;
  years: string | null;
  runtime: string | null;
  certification: string | null;
}

/** The meta row's facts, whichever are known; laid out with spacing, never separators. */
export function titleFacts(title: {
  type: TitleType;
  startYear: number | null;
  endYear: number | null;
  runtimeMinutes: number | null;
  certification?: string | null;
  rating: number | null;
}): TitleFacts {
  return {
    rating: title.rating !== null ? title.rating.toFixed(1) : null,
    kind: kindLabel(title.type),
    years: titleYears(title) || null,
    runtime:
      title.type === "movie"
        ? formatRuntime(title.runtimeMinutes) || null
        : null,
    certification: title.certification || null,
  };
}

export function kindLabel(type: TitleType): string {
  return type === "movie"
    ? "Film"
    : type === "series"
      ? "Series"
      : "Miniseries";
}

/** Two films back to back: "3h 41m together". */
export function combinedRuntime(
  a: number | null,
  b: number | null,
): string | null {
  if (!a || !b) return null;
  return `${formatRuntime(a + b)} together`;
}

/** "Season 1, episode 3", or whichever half is known. */
export function episodeLabel(
  season: number | null,
  episode: number | null,
): string | null {
  if (season !== null && episode !== null) {
    return `Season ${season}, episode ${episode}`;
  }
  if (episode !== null) return `Episode ${episode}`;
  return null;
}

/** "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
