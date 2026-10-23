import {
  type Genre,
  type TitleSort,
  type TitleType,
  titleQuerySchema,
} from "@repo/schemas/stream";

/** What Tune's dials and classic Search edit; serialised into a `TitleQuery`. */
export interface TitleFilters {
  q: string;
  type: TitleType | null;
  genres: Genre[];
  yearFrom: number | null;
  yearTo: number | null;
  ratingMin: number | null;
  runtimeMax: number | null;
  /** -1 light … +1 heavy. */
  moodMin: number | null;
  moodMax: number | null;
  sort: TitleSort;
}

export const EMPTY_FILTERS: TitleFilters = {
  q: "",
  type: null,
  genres: [],
  yearFrom: null,
  yearTo: null,
  ratingMin: null,
  runtimeMax: null,
  moodMin: null,
  moodMax: null,
  sort: "popular",
};

export const DEFAULT_PAGE_SIZE = 30;

export const SORT_LABELS: Record<TitleSort, string> = {
  popular: "Most popular",
  rating: "Highest rated",
  votes: "Most voted",
  newest: "Newest first",
  oldest: "Oldest first",
  title: "A to Z",
};

export const TYPE_LABELS: Record<TitleType, string> = {
  movie: "Films",
  series: "Series",
  miniseries: "Miniseries",
};

/**
 * Query-string values for `GET /titles`. Defaults are left out so equal
 * filters always make the same string (and the same query key); genres are
 * comma-separated in the order they were picked; a reversed year range is
 * put the right way round.
 */
export function titleQueryParams(
  filters: TitleFilters,
  cursor = 0,
  limit = DEFAULT_PAGE_SIZE,
): Record<string, string> {
  const params: Record<string, string> = {};
  const q = filters.q.trim();
  if (q) params.q = q;
  if (filters.type) params.type = filters.type;
  if (filters.genres.length > 0) params.genres = filters.genres.join(",");
  let { yearFrom, yearTo } = filters;
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    [yearFrom, yearTo] = [yearTo, yearFrom];
  }
  if (yearFrom !== null) params.yearFrom = String(yearFrom);
  if (yearTo !== null) params.yearTo = String(yearTo);
  if (filters.ratingMin !== null && filters.ratingMin > 0) {
    params.ratingMin = String(filters.ratingMin);
  }
  if (filters.runtimeMax !== null) {
    params.runtimeMax = String(filters.runtimeMax);
  }
  if (filters.moodMin !== null) params.moodMin = mood(filters.moodMin);
  if (filters.moodMax !== null) params.moodMax = mood(filters.moodMax);
  if (filters.sort !== "popular") params.sort = filters.sort;
  if (cursor > 0) params.cursor = String(cursor);
  if (limit !== DEFAULT_PAGE_SIZE) params.limit = String(limit);
  return params;
}

/** Two decimals at most, and never `-0`. */
function mood(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

export function titleQueryString(
  filters: TitleFilters,
  cursor = 0,
  limit = DEFAULT_PAGE_SIZE,
): string {
  return new URLSearchParams(titleQueryParams(filters, cursor, limit))
    .toString()
    .replace(/%2C/gi, ",");
}

/** A home rail's `query` as filters, through the server's own schema; anything it would refuse is dropped. */
export function filtersFromQuery(query: Record<string, string>): TitleFilters {
  const parsed = titleQuerySchema.safeParse(query);
  if (!parsed.success) return { ...EMPTY_FILTERS };
  const value = parsed.data;
  return {
    q: value.q ?? "",
    type: value.type ?? null,
    genres: value.genres ?? [],
    yearFrom: value.yearFrom ?? null,
    yearTo: value.yearTo ?? null,
    ratingMin: value.ratingMin ?? null,
    runtimeMax: value.runtimeMax ?? null,
    moodMin: value.moodMin ?? null,
    moodMax: value.moodMax ?? null,
    sort: value.sort,
  };
}

/** How many filters besides the search text and the sort are narrowing the list. */
export function activeFilterCount(filters: TitleFilters): number {
  return (
    (filters.type ? 1 : 0) +
    (filters.genres.length > 0 ? 1 : 0) +
    (filters.yearFrom !== null || filters.yearTo !== null ? 1 : 0) +
    (filters.ratingMin ? 1 : 0) +
    (filters.runtimeMax !== null ? 1 : 0) +
    (filters.moodMin !== null || filters.moodMax !== null ? 1 : 0)
  );
}

export function yearRangeLabel(
  yearFrom: number | null,
  yearTo: number | null,
): string | null {
  if (yearFrom !== null && yearTo !== null) {
    const [from, to] =
      yearFrom <= yearTo ? [yearFrom, yearTo] : [yearTo, yearFrom];
    return from === to ? String(from) : `${from}–${to}`;
  }
  if (yearFrom !== null) return `From ${yearFrom}`;
  if (yearTo !== null) return `Up to ${yearTo}`;
  return null;
}

/** Short labels for the filters in force, for the row under the search field. */
export function describeFilters(filters: TitleFilters): string[] {
  const labels: string[] = [];
  if (filters.type) labels.push(TYPE_LABELS[filters.type]);
  labels.push(...filters.genres);
  const years = yearRangeLabel(filters.yearFrom, filters.yearTo);
  if (years) labels.push(years);
  if (filters.ratingMin) labels.push(`Rated ${filters.ratingMin}+`);
  if (filters.sort !== "popular") labels.push(SORT_LABELS[filters.sort]);
  return labels;
}

export function toggleGenre(genres: Genre[], genre: Genre): Genre[] {
  return genres.includes(genre)
    ? genres.filter((item) => item !== genre)
    : [...genres, genre];
}

/** A typed year, or null for an empty or impossible one. */
export function parseYear(text: string): number | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 4) return null;
  const year = Number(digits);
  return year >= 1870 && year <= 2100 ? year : null;
}
