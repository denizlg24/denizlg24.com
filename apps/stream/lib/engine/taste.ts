/**
 * The recommendation engine's pure core. A title is a bag of weighted
 * features (genres, themes, people, language, era, kind); a profile's taste
 * is the same bag summed over what it watched, finished, saved or gave up
 * on, decayed by age. Scoring a candidate is the overlap of the two, plus a
 * quality prior, reach, freshness, and a boost when TMDB lists it among the
 * recommendations for something the profile liked.
 */

export interface EngineTitle {
  id: string;
  type: "movie" | "series" | "miniseries";
  title: string;
  genres: string[];
  keywords: string[];
  /** Billed cast first, then directors. */
  people: string[];
  directors: string[];
  originalLanguage: string | null;
  startYear: number | null;
  rating: number | null;
  votes: number;
  popularity: number;
  tmdbPopularity: number;
  tmdbId: number | null;
  related: number[];
  releaseDate: string | null;
}

export type Signal = "finished" | "watching" | "watchlist" | "abandoned";

export interface TasteEvent {
  title: EngineTitle;
  signal: Signal;
  at: Date;
}

export const SIGNAL_WEIGHT: Record<Signal, number> = {
  finished: 3,
  watching: 2,
  watchlist: 1.5,
  abandoned: -1.5,
};

/** A stale start (under 15 % two weeks ago) reads as given up on. */
export function signalOf(row: {
  completed: boolean;
  positionS: number;
  durationS: number;
  updatedAt: Date;
}): Signal {
  if (row.completed) return "finished";
  const stale = Date.now() - row.updatedAt.getTime() > 14 * 86_400_000;
  const barely = row.durationS > 0 && row.positionS / row.durationS < 0.15;
  return stale && barely ? "abandoned" : "watching";
}

const HALF_LIFE_DAYS = 120;

/** How much each kind of feature says about taste, relative to a genre. */
const KIND_WEIGHT = {
  genre: 1,
  keyword: 0.7,
  person: 0.6,
  director: 1.1,
  language: 0.6,
  decade: 0.25,
  kind: 0.35,
} as const;
type FeatureKind = keyof typeof KIND_WEIGHT;

export function kindOf(type: EngineTitle["type"]): "movie" | "tv" {
  return type === "movie" ? "movie" : "tv";
}

const featureCache = new WeakMap<EngineTitle, Map<string, number>>();

/** Feature → weight, each kind normalised so a title with many keywords is not louder. */
export function featuresOf(title: EngineTitle): Map<string, number> {
  const cached = featureCache.get(title);
  if (cached) return cached;
  const features = new Map<string, number>();
  const add = (kind: FeatureKind, values: readonly string[], cap: number) => {
    const list = values.slice(0, cap);
    if (list.length === 0) return;
    const each = KIND_WEIGHT[kind] / Math.sqrt(list.length);
    for (const value of list) {
      const key = `${kind}:${value}`;
      features.set(key, (features.get(key) ?? 0) + each);
    }
  };
  add("genre", title.genres, 3);
  add("keyword", title.keywords, 12);
  add(
    "person",
    title.people.filter((name) => !title.directors.includes(name)),
    6,
  );
  add("director", title.directors, 3);
  if (title.originalLanguage) add("language", [title.originalLanguage], 1);
  if (title.startYear)
    add("decade", [String(Math.floor(title.startYear / 10) * 10)], 1);
  add("kind", [kindOf(title.type)], 1);
  featureCache.set(title, features);
  return features;
}

export interface Seed {
  title: EngineTitle;
  weight: number;
  signal: Signal;
  at: Date;
}

export interface Taste {
  weights: Map<string, number>;
  /** Positive history, strongest first: the "Because you watched" anchors. */
  seeds: Seed[];
  /** Everything with a progress row or on the list: never picked again. */
  seen: Set<string>;
  norm: number;
  empty: boolean;
}

export function decay(at: Date, now: Date): number {
  const days = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
  return 0.5 ** (days / HALF_LIFE_DAYS);
}

export function buildTaste(
  events: readonly TasteEvent[],
  favoriteGenres: readonly string[],
  now = new Date(),
): Taste {
  const weights = new Map<string, number>();
  const bump = (key: string, value: number) =>
    weights.set(key, (weights.get(key) ?? 0) + value);
  for (const genre of favoriteGenres) bump(`genre:${genre}`, 1.5);
  const seeds: Seed[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    seen.add(event.title.id);
    const weight = SIGNAL_WEIGHT[event.signal] * decay(event.at, now);
    for (const [key, value] of featuresOf(event.title)) {
      bump(key, value * weight);
    }
    if (weight > 0) {
      seeds.push({
        title: event.title,
        weight,
        signal: event.signal,
        at: event.at,
      });
    }
  }
  seeds.sort((a, b) => b.weight - a.weight);
  let norm = 0;
  for (const value of weights.values()) norm += value * value;
  norm = Math.sqrt(norm);
  return {
    weights,
    seeds,
    seen,
    norm,
    empty: events.length === 0 && favoriteGenres.length === 0,
  };
}

/** Cosine-like overlap between a candidate and a taste, roughly −1…1. */
export function tasteMatch(title: EngineTitle, taste: Taste): number {
  if (taste.norm === 0) return 0;
  const features = featuresOf(title);
  let dot = 0;
  let own = 0;
  for (const [key, value] of features) {
    own += value * value;
    dot += value * (taste.weights.get(key) ?? 0);
  }
  return own === 0 ? 0 : dot / (Math.sqrt(own) * taste.norm);
}

/** Feature overlap of two titles, 0…1, for "More like this". */
export function titleSimilarity(a: EngineTitle, b: EngineTitle): number {
  const fa = featuresOf(a);
  const fb = featuresOf(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [key, value] of fa) {
    na += value * value;
    dot += value * (fb.get(key) ?? 0);
  }
  for (const value of fb.values()) nb += value * value;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Bayesian rating, 0…1: a 9.0 on 200 votes does not beat an 8.5 on 2M. */
export function quality(title: EngineTitle): number {
  if (title.rating === null) return 0.3;
  const m = 4000;
  const prior = 6.6;
  const bayes = (title.votes * title.rating + m * prior) / (title.votes + m);
  return Math.min(1, Math.max(0, (bayes - 5.5) / 3));
}

/** 0…1 from reach and TMDB's current buzz. */
export function popularityOf(title: EngineTitle): number {
  const reach = Math.min(1, title.popularity / 6);
  const buzz = Math.min(1, Math.log10(1 + title.tmdbPopularity) / 3);
  return reach * 0.6 + buzz * 0.4;
}

export function freshness(title: EngineTitle, now = new Date()): number {
  if (!title.startYear) return 0;
  const age = now.getUTCFullYear() - title.startYear;
  return age <= 0 ? 1 : Math.max(0, 1 - age / 12);
}

export interface ScoreContext {
  tastes: readonly Taste[];
  languages: ReadonlySet<string>;
  /** `movie:123` / `tv:456` → the strongest seed recommending it. */
  relatedTo: ReadonlyMap<string, Seed>;
  now?: Date;
}

export interface Scored<T extends EngineTitle = EngineTitle> {
  title: T;
  score: number;
  match: number;
  because: Seed | null;
}

/**
 * One number per candidate. A group needs common ground, so the audience's
 * match is the mean pulled toward the least-pleased member.
 */
export function scoreTitle<T extends EngineTitle>(
  title: T,
  context: ScoreContext,
): Scored<T> {
  const matches = context.tastes.map((taste) => tasteMatch(title, taste));
  const match =
    matches.length === 0
      ? 0
      : (matches.reduce((sum, value) => sum + value, 0) / matches.length) *
          0.6 +
        Math.min(...matches) * 0.4;
  const cold = context.tastes.every((taste) => taste.empty);
  const because =
    title.tmdbId === null
      ? null
      : (context.relatedTo.get(`${kindOf(title.type)}:${title.tmdbId}`) ??
        null);
  const foreign =
    title.originalLanguage !== null &&
    context.languages.size > 0 &&
    !context.languages.has(title.originalLanguage);
  const score =
    (cold ? 0 : match * 1.6) +
    quality(title) * 0.9 +
    popularityOf(title) * (cold ? 1 : 0.55) +
    freshness(title, context.now) * 0.25 +
    (because ? 0.45 * Math.min(1, because.weight / 3) : 0) -
    (foreign ? 0.6 : 0);
  return { title, score, match, because };
}

/**
 * Maximal marginal relevance: each next pick trades its own score against
 * how much it repeats what was already chosen, so a row of twenty is not
 * twenty superhero sequels.
 */
export function diversify<T extends EngineTitle>(
  scored: readonly Scored<T>[],
  count: number,
  lambda = 0.78,
): Scored<T>[] {
  const pool = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, count * 4);
  const chosen: Scored<T>[] = [];
  const top = pool[0]?.score ?? 1;
  while (chosen.length < count && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const redundancy = chosen.reduce(
        (max, picked) =>
          Math.max(max, titleSimilarity(candidate.title, picked.title)),
        0,
      );
      const value =
        lambda * (candidate.score / Math.max(top, 0.0001)) -
        (1 - lambda) * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    chosen.push(pool[bestIndex]);
    pool.splice(bestIndex, 1);
  }
  return chosen;
}

/** Languages the audience watches; English at a cold start. */
export function preferredLanguages(tastes: readonly Taste[]): Set<string> {
  const weights = new Map<string, number>();
  for (const taste of tastes) {
    for (const [key, value] of taste.weights) {
      if (key.startsWith("language:") && value > 0) {
        const language = key.slice("language:".length);
        weights.set(language, (weights.get(language) ?? 0) + value);
      }
    }
  }
  const languages = new Set(["en"]);
  const max = Math.max(0, ...weights.values());
  for (const [language, value] of weights) {
    if (value >= max * 0.15) languages.add(language);
  }
  return languages;
}

/** The strongest features of one kind across the audience, e.g. top genres. */
export function topFeatures(
  tastes: readonly Taste[],
  kind: FeatureKind,
  count: number,
): string[] {
  const totals = new Map<string, number>();
  for (const taste of tastes) {
    for (const [key, value] of taste.weights) {
      if (!key.startsWith(`${kind}:`)) continue;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }
  return [...totals]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => key.slice(kind.length + 1));
}
