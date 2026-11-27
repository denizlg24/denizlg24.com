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

const score = z.number().min(0).max(100);
const milliseconds = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "number" ? value : Date.parse(value)))
  .pipe(z.number().positive());

const indicatorSchema = z.object({ score, timestamp: milliseconds });

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
});

export type FearGreedPoint = { time: number; score: number };
export type FearGreedIndicator = {
  key: (typeof indicatorKeys)[keyof typeof indicatorKeys][0];
  label: string;
  score: number;
  band: BandKey;
  updatedAt: number;
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
export type FearGreedResult = FearGreed & {
  source: typeof fearGreedSource;
  fetchedAt: number;
  /** The last refresh failed; this is the previous good reading. */
  stale: boolean;
};

const round = (value: number) => Math.round(value * 10) / 10;
const roundOrNull = (value: number | null | undefined) =>
  value == null ? null : round(value);

/** CNN's rating strings are ignored: bands are derived from the score so every surface agrees. */
export function parseFearGreed(payload: unknown): FearGreed {
  const raw = rawSchema.parse(payload);
  const current = raw.fear_and_greed;
  const read = (key: keyof typeof indicatorKeys): FearGreedIndicator => {
    const [name, label] = indicatorKeys[key];
    const item = raw[key];
    return {
      key: name,
      label,
      score: round(item.score),
      band: bandFor(item.score).key,
      updatedAt: item.timestamp,
    };
  };
  return {
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

const indicatorOrder: FearGreedIndicator["key"][] = [
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
