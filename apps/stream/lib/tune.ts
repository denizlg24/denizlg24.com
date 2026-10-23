import type { TitleQueryInput, TitleSort } from "@repo/schemas/stream";

export interface DialOption<T> {
  label: string;
  value: T;
}

export const TIME: DialOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "30m", value: 40 },
  { label: "1h", value: 70 },
  { label: "1h30", value: 100 },
  { label: "2h", value: 130 },
  { label: "2h30", value: 160 },
];

export const MOOD: DialOption<readonly [number, number] | null>[] = [
  { label: "Any", value: null },
  { label: "Light", value: [-1, -0.55] },
  { label: "Bright", value: [-0.7, -0.15] },
  { label: "Balanced", value: [-0.35, 0.35] },
  { label: "Serious", value: [0.15, 0.7] },
  { label: "Dark", value: [0.5, 1] },
];

export const ACCLAIM: DialOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "6+", value: 6 },
  { label: "7+", value: 7 },
  { label: "7.5+", value: 7.5 },
  { label: "8+", value: 8 },
  { label: "8.5+", value: 8.5 },
];

const THIS_DECADE = Math.floor(new Date().getUTCFullYear() / 10) * 10;
export const DECADES: number[] = Array.from(
  { length: (THIS_DECADE - 1920) / 10 + 1 },
  (_, index) => 1920 + index * 10,
);

export const KINDS = [
  { label: "Either", value: null },
  { label: "Films", value: "movie" },
  { label: "Series", value: "series" },
] as const;
export type Kind = (typeof KINDS)[number]["value"];

export const SORTS: DialOption<TitleSort>[] = [
  { label: "Popular", value: "popular" },
  { label: "Best rated", value: "rating" },
  { label: "Newest", value: "newest" },
];

export interface TuneState {
  time: number;
  mood: number;
  acclaim: number;
  eraFrom: number;
  eraTo: number;
  kind: Kind;
  sort: TitleSort;
  q: string;
}

export const DEFAULT_TUNE: TuneState = {
  time: 0,
  mood: 0,
  acclaim: 0,
  eraFrom: 0,
  eraTo: DECADES.length - 1,
  kind: null,
  sort: "popular",
  q: "",
};

function clampIndex(value: number, length: number): number {
  return Number.isInteger(value) && value >= 0 && value < length ? value : 0;
}

export function tuneToQuery(state: TuneState): TitleQueryInput {
  const query: TitleQueryInput = { sort: state.sort };
  const time = TIME[state.time]?.value ?? null;
  const mood = MOOD[state.mood]?.value ?? null;
  const acclaim = ACCLAIM[state.acclaim]?.value ?? null;
  if (time !== null) query.runtimeMax = time;
  if (mood !== null) [query.moodMin, query.moodMax] = mood;
  if (acclaim !== null) query.ratingMin = acclaim;
  if (state.eraFrom > 0) query.yearFrom = DECADES[state.eraFrom];
  if (state.eraTo < DECADES.length - 1) query.yearTo = DECADES[state.eraTo] + 9;
  if (state.kind) query.type = state.kind;
  if (state.q.trim()) query.q = state.q.trim();
  return query;
}

export function tuneToParams(state: TuneState): URLSearchParams {
  const params = new URLSearchParams();
  const defaults = DEFAULT_TUNE;
  if (state.time !== defaults.time) params.set("time", String(state.time));
  if (state.mood !== defaults.mood) params.set("mood", String(state.mood));
  if (state.acclaim !== defaults.acclaim)
    params.set("acclaim", String(state.acclaim));
  if (state.eraFrom !== defaults.eraFrom)
    params.set("from", String(state.eraFrom));
  if (state.eraTo !== defaults.eraTo) params.set("to", String(state.eraTo));
  if (state.kind) params.set("kind", state.kind);
  if (state.sort !== defaults.sort) params.set("sort", state.sort);
  if (state.q.trim()) params.set("q", state.q.trim());
  return params;
}

export function tuneFromParams(
  params: Record<string, string | string[] | undefined>,
): TuneState {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const index = (key: string, length: number, fallback: number) => {
    const raw = one(key);
    return raw === undefined ? fallback : clampIndex(Number(raw), length);
  };
  const kind =
    KINDS.find((option) => option.value === one("kind"))?.value ?? null;
  const sort =
    SORTS.find((option) => option.value === one("sort"))?.value ?? "popular";
  const eraFrom = index("from", DECADES.length, 0);
  const eraTo = index("to", DECADES.length, DECADES.length - 1);
  return {
    time: index("time", TIME.length, 0),
    mood: index("mood", MOOD.length, 0),
    acclaim: index("acclaim", ACCLAIM.length, 0),
    eraFrom: Math.min(eraFrom, eraTo),
    eraTo: Math.max(eraFrom, eraTo),
    kind,
    sort,
    q: one("q") ?? "",
  };
}

export function queryString(query: TitleQueryInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return params.toString();
}
