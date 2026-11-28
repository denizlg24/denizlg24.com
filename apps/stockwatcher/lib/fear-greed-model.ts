import { z } from "zod";
import { exchangeStatus } from "./exchanges";

export const fearGreedSource = "CNN Fear & Greed";

export const bands = [
  { key: "extremeFear", label: "Extreme Fear", min: 0, max: 25 },
  { key: "fear", label: "Fear", min: 25, max: 45 },
  { key: "neutral", label: "Neutral", min: 45, max: 55 },
  { key: "greed", label: "Greed", min: 55, max: 75 },
  { key: "extremeGreed", label: "Extreme Greed", min: 75, max: 100 },
] as const;
export type BandKey = (typeof bands)[number]["key"];

/** Bands are half-open, [min, max); 100 belongs to Extreme Greed. */
export function bandFor(score: number) {
  const clamped = Math.min(100, Math.max(0, score));
  return (
    bands.find((band) => clamped >= band.min && clamped < band.max) ??
    bands[bands.length - 1]
  );
}

const indicatorKeys = {
  market_momentum_sp500: ["momentum", "Market momentum"],
  stock_price_strength: ["strength", "Stock price strength"],
  stock_price_breadth: ["breadth", "Stock price breadth"],
  put_call_options: ["putCall", "Put and call options"],
  junk_bond_demand: ["junkBond", "Junk bond demand"],
  market_volatility_vix: ["volatility", "Market volatility"],
  safe_haven_demand: ["safeHaven", "Safe haven demand"],
} as const;
export type IndicatorKey =
  (typeof indicatorKeys)[keyof typeof indicatorKeys][0];

/**
 * What CNN's per-indicator `data` series hold: the raw input behind each
 * score, not the score's own history. Momentum and volatility come with a
 * companion series (the 125-day S&P average, the VIX 50-day average).
 */
export const indicatorInputs: Record<
  IndicatorKey,
  { label: string; reference?: string; format: (value: number) => string }
> = {
  momentum: {
    label: "S&P 500",
    reference: "125-day average",
    format: (value) => grouped(value, 0),
  },
  strength: {
    label: "Net new 52-week highs, % of NYSE",
    format: (value) => `${signed2(value)}%`,
  },
  breadth: {
    label: "McClellan Volume Summation",
    format: (value) => grouped(value, 0),
  },
  putCall: {
    label: "Put/call ratio, 5-day average",
    format: (value) => value.toFixed(2),
  },
  junkBond: {
    label: "Junk over investment-grade yield, pts",
    format: (value) => value.toFixed(2),
  },
  volatility: {
    label: "VIX",
    reference: "50-day average",
    format: (value) => value.toFixed(2),
  },
  safeHaven: {
    label: "Stocks minus bonds, 20-day return, pts",
    format: (value) => signed2(value),
  },
};

const grouped = (value: number, digits: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const signed2 = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;

const score = z.number().min(0).max(100);
const milliseconds = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "number" ? value : Date.parse(value)))
  .pipe(z.number().positive());

const seriesSchema = z
  .array(z.object({ x: z.number().positive(), y: z.number().finite() }))
  .optional();
const indicatorSchema = z.object({
  score,
  timestamp: milliseconds,
  data: seriesSchema,
});
const companionSchema = z.object({ data: seriesSchema }).optional();

const rawSchema = z.object({
  fear_and_greed: z.object({
    score,
    timestamp: milliseconds,
    previous_close: score.nullish(),
    previous_1_week: score.nullish(),
    previous_1_month: score.nullish(),
    previous_1_year: score.nullish(),
  }),
  fear_and_greed_historical: z.object({
    data: z.array(z.object({ x: z.number().positive(), y: score })),
  }),
  market_momentum_sp500: indicatorSchema,
  stock_price_strength: indicatorSchema,
  stock_price_breadth: indicatorSchema,
  put_call_options: indicatorSchema,
  junk_bond_demand: indicatorSchema,
  market_volatility_vix: indicatorSchema,
  safe_haven_demand: indicatorSchema,
  market_momentum_sp125: companionSchema,
  market_volatility_vix_50: companionSchema,
});

export type FearGreedPoint = { time: number; score: number };
export type RawPoint = { time: number; value: number };
export type FearGreedIndicator = {
  key: IndicatorKey;
  label: string;
  score: number;
  band: BandKey;
  updatedAt: number;
  /** The latest raw input (VIX level, put/call ratio, …), when CNN sends its series. */
  raw: number | null;
  /** The companion average for momentum and volatility. */
  reference: number | null;
};
export type FearGreedPrevious = {
  close: number | null;
  week: number | null;
  month: number | null;
  year: number | null;
};
export type FearGreed = {
  score: number;
  band: BandKey;
  updatedAt: number;
  previous: FearGreedPrevious;
  history: FearGreedPoint[];
  indicators: FearGreedIndicator[];
};
/** The parsed document, with the raw input series kept server-side for history. */
export type FearGreedDocument = FearGreed & {
  rawHistory: Record<IndicatorKey, RawPoint[]>;
};
export type FearGreedResult = FearGreed & {
  source: typeof fearGreedSource;
  fetchedAt: number;
  /** The last refresh failed; this is the previous good reading. */
  stale: boolean;
};

const round = (value: number) => Math.round(value * 10) / 10;
const roundOrNull = (value: number | null | undefined) =>
  value == null ? null : round(value);

const toRaw = (series: { x: number; y: number }[] | undefined): RawPoint[] =>
  (series ?? [])
    .map((point) => ({ time: point.x, value: point.y }))
    .toSorted((a, b) => a.time - b.time);
const lastValue = (series: RawPoint[]) => series.at(-1)?.value ?? null;

/** CNN's rating strings are ignored: bands are derived from the score so every surface agrees. */
export function parseFearGreed(payload: unknown): FearGreedDocument {
  const raw = rawSchema.parse(payload);
  const current = raw.fear_and_greed;
  const series = (key: keyof typeof indicatorKeys) => toRaw(raw[key].data);
  const rawHistory: Record<IndicatorKey, RawPoint[]> = {
    momentum: series("market_momentum_sp500"),
    strength: series("stock_price_strength"),
    breadth: series("stock_price_breadth"),
    putCall: series("put_call_options"),
    junkBond: series("junk_bond_demand"),
    volatility: series("market_volatility_vix"),
    safeHaven: series("safe_haven_demand"),
  };
  const references: Partial<Record<IndicatorKey, number | null>> = {
    momentum: lastValue(toRaw(raw.market_momentum_sp125?.data)),
    volatility: lastValue(toRaw(raw.market_volatility_vix_50?.data)),
  };
  const read = (key: keyof typeof indicatorKeys): FearGreedIndicator => {
    const [name, label] = indicatorKeys[key];
    const item = raw[key];
    return {
      key: name,
      label,
      score: round(item.score),
      band: bandFor(item.score).key,
      updatedAt: item.timestamp,
      raw: lastValue(rawHistory[name]),
      reference: references[name] ?? null,
    };
  };
  return {
    rawHistory,
    score: round(current.score),
    band: bandFor(current.score).key,
    updatedAt: current.timestamp,
    previous: {
      close: roundOrNull(current.previous_close),
      week: roundOrNull(current.previous_1_week),
      month: roundOrNull(current.previous_1_month),
      year: roundOrNull(current.previous_1_year),
    },
    history: raw.fear_and_greed_historical.data
      .map((point) => ({ time: point.x, score: round(point.y) }))
      .toSorted((a, b) => a.time - b.time),
    indicators: (Object.keys(indicatorKeys) as (keyof typeof indicatorKeys)[])
      .map(read)
      .toSorted((a, b) => orderOf(a.key) - orderOf(b.key)),
  };
}

export const indicatorOrder: IndicatorKey[] = [
  "momentum",
  "strength",
  "breadth",
  "putCall",
  "junkBond",
  "volatility",
  "safeHaven",
];
const orderOf = (key: FearGreedIndicator["key"]) => indicatorOrder.indexOf(key);

/** Evenly spaced points that always keep the first and last. */
export function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const last = items.length - 1;
  const picked = new Set<number>();
  for (let step = 0; step < max; step++)
    picked.add(Math.round((step * last) / (max - 1)));
  return [...picked].map((index) => items[index]);
}

export const bandLabel = (key: BandKey) =>
  bands.find((band) => band.key === key)?.label ?? key;

const marketHoursTtlMs = 60_000;
const offHoursTtlMs = 15 * 60_000;

/** Refresh every minute while the NYSE is open, every 15 minutes otherwise. */
export const ttlAt = (now: number) =>
  exchangeStatus("NYSE", now).state === "open"
    ? marketHoursTtlMs
    : offHoursTtlMs;

export const score1 = (value: number) => value.toFixed(1);
export const signed1 = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const dailyIndicatorSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  raw: z.number().finite().nullable(),
});
/** One stored trading day. Backfilled days know CNN's raw inputs but not the sub-scores. */
export const fearGreedDaySchema = z.object({
  day: z.iso.date(),
  score,
  indicators: z.partialRecord(z.enum(indicatorOrder), dailyIndicatorSchema),
});
export type FearGreedDay = z.infer<typeof fearGreedDaySchema>;

/**
 * Turns one CNN document into daily rows: its one-year index history, the
 * raw inputs on the days CNN reports them, and today's reading with every
 * sub-score.
 */
export function daysFromDocument(doc: FearGreedDocument): FearGreedDay[] {
  const days = new Map<string, FearGreedDay>();
  for (const point of doc.history) {
    const day = dayOf(point.time);
    days.set(day, { day, score: point.score, indicators: {} });
  }
  for (const key of indicatorOrder) {
    for (const point of doc.rawHistory[key]) {
      const row = days.get(dayOf(point.time));
      if (row) row.indicators[key] = { score: null, raw: point.value };
    }
  }
  const today = dayOf(doc.updatedAt);
  days.set(today, {
    day: today,
    score: doc.score,
    indicators: Object.fromEntries(
      doc.indicators.map((item) => [
        item.key,
        { score: item.score, raw: item.raw },
      ]),
    ),
  });
  return [...days.values()].toSorted((a, b) => a.day.localeCompare(b.day));
}

/** Stored days extend the history; CNN's own values win where both have a day. */
export function mergeDays(
  stored: readonly FearGreedDay[],
  fresh: readonly FearGreedDay[],
): FearGreedDay[] {
  const days = new Map(stored.map((row) => [row.day, row]));
  for (const row of fresh) {
    const prior = days.get(row.day);
    if (!prior) {
      days.set(row.day, row);
      continue;
    }
    const indicators: FearGreedDay["indicators"] = { ...prior.indicators };
    for (const key of indicatorOrder) {
      const next = row.indicators[key];
      if (!next) continue;
      const before = indicators[key];
      indicators[key] = {
        score: next.score ?? before?.score ?? null,
        raw: next.raw ?? before?.raw ?? null,
      };
    }
    days.set(row.day, { day: row.day, score: row.score, indicators });
  }
  return [...days.values()].toSorted((a, b) => a.day.localeCompare(b.day));
}

export const historyRanges = ["1M", "3M", "6M", "1Y", "ALL"] as const;
export type HistoryRange = (typeof historyRanges)[number];
const rangeMonths: Record<Exclude<HistoryRange, "ALL">, number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
};

/** The first day inside a range ending at `last` (YYYY-MM-DD). */
export function rangeStart(range: HistoryRange, last: string) {
  if (range === "ALL") return "0000-00-00";
  const date = new Date(`${last}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - rangeMonths[range]);
  return date.toISOString().slice(0, 10);
}

export type DayScore = { date: string; score: number };

export type Regime = {
  total: number;
  bands: { key: BandKey; days: number; share: number }[];
  streak: { band: BandKey; days: number; since: string } | null;
  /** Share of readings in the window at or below the latest, 0-100. */
  percentile: number | null;
};

export function regime(points: readonly DayScore[]): Regime {
  const counts = new Map<BandKey, number>();
  for (const point of points) {
    const key = bandFor(point.score).key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const last = points.at(-1);
  let streak: Regime["streak"] = null;
  if (last) {
    const band = bandFor(last.score).key;
    let index = points.length - 1;
    while (index > 0 && bandFor(points[index - 1].score).key === band) index--;
    streak = { band, days: points.length - index, since: points[index].date };
  }
  return {
    total: points.length,
    bands: bands.map((band) => {
      const days = counts.get(band.key) ?? 0;
      return {
        key: band.key,
        days,
        share: points.length ? (days / points.length) * 100 : 0,
      };
    }),
    streak,
    percentile: last
      ? (points.filter((point) => point.score <= last.score).length /
          points.length) *
        100
      : null,
  };
}

export type Close = { date: string; close: number };
export type ForwardStat = {
  n: number;
  median: number | null;
  hitRate: number | null;
};
export const forwardHorizons = [
  { key: "1M", days: 21 },
  { key: "3M", days: 63 },
] as const;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

function stat(values: number[]): ForwardStat {
  return {
    n: values.length,
    median: median(values),
    hitRate: values.length
      ? (values.filter((value) => value > 0).length / values.length) * 100
      : null,
  };
}

/**
 * Subsequent index returns (in %) after each reading, `days` trading days
 * out, measured from the first close on or after the reading's day. Windows
 * overlap, so n counts days, not independent episodes.
 */
export function forwardReturns(
  points: readonly DayScore[],
  closes: readonly Close[],
  band: BandKey,
): {
  horizon: (typeof forwardHorizons)[number]["key"];
  inBand: ForwardStat;
  all: ForwardStat;
}[] {
  const sorted = closes.toSorted((a, b) => a.date.localeCompare(b.date));
  const firstOnOrAfter = (date: string) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (sorted[mid].date < date) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return forwardHorizons.map((horizon) => {
    const inBand: number[] = [];
    const all: number[] = [];
    for (const point of points) {
      const start = firstOnOrAfter(point.date);
      const end = start + horizon.days;
      if (end >= sorted.length) continue;
      const change = (sorted[end].close / sorted[start].close - 1) * 100;
      all.push(change);
      if (bandFor(point.score).key === band) inBand.push(change);
    }
    return { horizon: horizon.key, inBand: stat(inBand), all: stat(all) };
  });
}

export const fearGreedRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["below", "above"]),
    threshold: z.number().int().min(1).max(99),
  }),
  z.object({
    kind: z.literal("band"),
    band: z.enum(bands.map((band) => band.key)),
  }),
]);
export type FearGreedRule = z.infer<typeof fearGreedRuleSchema>;

export function ruleName(rule: FearGreedRule) {
  return rule.kind === "band"
    ? `Fear & Greed enters ${bandLabel(rule.band)}`
    : `Fear & Greed ${rule.kind} ${rule.threshold}`;
}

/** The signal script for a rule; it reads `data.fearGreed` from the compute request `{ fearGreed: true }`. */
export function ruleScript(rule: FearGreedRule) {
  const condition =
    rule.kind === "band"
      ? `fg.band === ${JSON.stringify(rule.band)}`
      : `fg.score ${rule.kind === "below" ? "<" : ">"} ${rule.threshold}`;
  return [
    "const fg = data.fearGreed;",
    'if (!fg) throw new Error("CNN Fear & Greed did not load");',
    `return { trigger: ${condition}, value: fg.score, message: "Fear & Greed " + fg.score + " (" + fg.rating + ")" };`,
  ].join("\n");
}

export type FearGreedHistory = {
  /** Stored days merged with CNN's current year, oldest first. */
  days: FearGreedDay[];
  storedDays: number;
  firstStored: string | null;
  source: typeof fearGreedSource;
  fetchedAt: number | null;
};
export type FearGreedHistoryResponse = FearGreedHistory & {
  spx: Close[];
  spxError: string | null;
};
