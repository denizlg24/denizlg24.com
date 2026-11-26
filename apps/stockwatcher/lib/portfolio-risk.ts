import { TRADING_DAYS } from "./analytics";
import type { ChartPoint } from "./models";

export const dayOf = (time: number) => Math.floor(time / 86_400);
export const isoDay = (day: number) =>
  new Date(day * 86_400_000).toISOString().slice(0, 10);
export const parseDay = (iso: string) =>
  Math.floor(Date.parse(iso) / 86_400_000);

const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
const sampleVariance = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return (
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) /
    (values.length - 1)
  );
};
export const sampleStdev = (values: number[]) =>
  Math.sqrt(sampleVariance(values));

/** Last close on or before each day, forward-filled; null before the first bar. */
export function closesOn(
  points: ChartPoint[],
  days: number[],
): (number | null)[] {
  const out: (number | null)[] = [];
  let pointer = 0;
  let last: number | null = null;
  for (const day of days) {
    while (pointer < points.length && dayOf(points[pointer].time) <= day)
      last = points[pointer++].close;
    out.push(last);
  }
  return out;
}

export function closeOnOrBefore(points: ChartPoint[], day: number) {
  let found: number | null = null;
  for (const point of points) {
    if (dayOf(point.time) > day) break;
    found = point.close;
  }
  return found;
}

export function dailyReturns(closes: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const next = closes[i];
    out.push(prev && next != null ? next / prev - 1 : null);
  }
  return out;
}

export function unionDays(histories: ChartPoint[][], from: number, to: number) {
  const days = new Set<number>();
  for (const points of histories)
    for (const point of points) {
      const day = dayOf(point.time);
      if (day >= from && day <= to) days.add(day);
    }
  return [...days].sort((a, b) => a - b);
}

/**
 * Constant-weight portfolio return per day. Weights renormalise over the
 * holdings that have a return that day; days where under half the weight is
 * covered are dropped so a short-history holding cannot dominate the series.
 */
export function portfolioReturns(
  weights: number[],
  returns: (number | null)[][],
  minCoverage = 0.5,
) {
  const length = returns[0]?.length ?? 0;
  const out: (number | null)[] = [];
  let covered = 0;
  let counted = 0;
  for (let t = 0; t < length; t++) {
    let available = 0;
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      const value = returns[i][t];
      if (value == null) continue;
      available += weights[i];
      sum += weights[i] * value;
    }
    if (available < minCoverage) {
      out.push(null);
      continue;
    }
    out.push(sum / available);
    covered += available;
    counted++;
  }
  return { returns: out, coverage: counted ? covered / counted : 0 };
}

export type OlsFit = {
  coefficients: number[];
  standardErrors: number[];
  tStats: number[];
  r2: number;
  adjustedR2: number;
  residualStdev: number;
  observations: number;
};

function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-14) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (!factor) continue;
      for (let j = 0; j < 2 * n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

/** OLS with an intercept as coefficient 0; `x` holds one row of regressors per observation. */
export function ols(y: number[], x: number[][]): OlsFit | null {
  const n = y.length;
  const k = (x[0]?.length ?? 0) + 1;
  if (n <= k + 5) return null;
  const rows = x.map((row) => [1, ...row]);
  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let t = 0; t < n; t++)
    for (let i = 0; i < k; i++) {
      xty[i] += rows[t][i] * y[t];
      for (let j = 0; j < k; j++) xtx[i][j] += rows[t][i] * rows[t][j];
    }
  const inverse = invert(xtx);
  if (!inverse) return null;
  const coefficients = inverse.map((row) =>
    row.reduce((sum, value, j) => sum + value * xty[j], 0),
  );
  const my = mean(y);
  let sse = 0;
  let sst = 0;
  for (let t = 0; t < n; t++) {
    const fitted = rows[t].reduce(
      (sum, value, i) => sum + value * coefficients[i],
      0,
    );
    sse += (y[t] - fitted) ** 2;
    sst += (y[t] - my) ** 2;
  }
  if (!sst) return null;
  const sigma2 = sse / (n - k);
  const standardErrors = inverse.map((row, i) =>
    Math.sqrt(Math.max(0, row[i] * sigma2)),
  );
  return {
    coefficients,
    standardErrors,
    tStats: coefficients.map((c, i) =>
      standardErrors[i] ? c / standardErrors[i] : 0,
    ),
    r2: 1 - sse / sst,
    adjustedR2: 1 - sse / (n - k) / (sst / (n - 1)),
    residualStdev: Math.sqrt(sigma2),
    observations: n,
  };
}

export const Z: Record<number, number> = { 0.95: 1.6448536, 0.99: 2.3263479 };

function quantile(sorted: number[], p: number) {
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function horizonReturns(daily: number[], horizon: number) {
  if (horizon === 1) return daily;
  const out: number[] = [];
  let product = 1;
  for (let i = 0; i < daily.length; i++) {
    product *= 1 + daily[i];
    if (i >= horizon) product /= 1 + daily[i - horizon];
    if (i >= horizon - 1) out.push(product - 1);
  }
  return out;
}

export function historicalTail(returns: number[], confidence: number) {
  if (returns.length < 30) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = quantile(sorted, 1 - confidence);
  const tail = sorted.filter((value) => value <= cutoff);
  return { var: Math.max(0, -cutoff), es: Math.max(0, -mean(tail)) };
}

/** Normal-distribution VaR and ES with zero drift over the horizon. */
export function parametricTail(
  dailyStdev: number,
  horizon: number,
  confidence: number,
) {
  const z = Z[confidence];
  const sigma = dailyStdev * Math.sqrt(horizon);
  const density = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
  return { var: z * sigma, es: (sigma * density) / (1 - confidence) };
}

export function moments(values: number[]) {
  const m = mean(values);
  const v =
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
  if (!v) return { skew: 0, excessKurtosis: 0 };
  const sd = Math.sqrt(v);
  return {
    skew:
      values.reduce((sum, value) => sum + ((value - m) / sd) ** 3, 0) /
      values.length,
    excessKurtosis:
      values.reduce((sum, value) => sum + ((value - m) / sd) ** 4, 0) /
        values.length -
      3,
  };
}

export const annualise = (daily: number) => daily * TRADING_DAYS;

export type Scenario = { key: string; label: string; from: string; to: string };

export const namedScenarios: Scenario[] = [
  {
    key: "gfc2008",
    label: "2008 global financial crisis",
    from: "2008-09-02",
    to: "2009-03-09",
  },
  {
    key: "covid2020",
    label: "2020 Covid crash",
    from: "2020-02-19",
    to: "2020-03-23",
  },
  {
    key: "rates2022",
    label: "2022 rate shock",
    from: "2022-01-03",
    to: "2022-10-12",
  },
  {
    key: "q42018",
    label: "2018 Q4 selloff",
    from: "2018-09-20",
    to: "2018-12-24",
  },
];

export const shockDrivers = {
  rates: {
    symbol: "^TNX",
    label: "US 10-year yield",
    unit: "bp",
    mode: "level",
    scale: 0.01,
  },
  oil: {
    symbol: "CL=F",
    label: "WTI crude oil",
    unit: "%",
    mode: "return",
    scale: 0.01,
  },
  usd: {
    symbol: "DX-Y.NYB",
    label: "US dollar index",
    unit: "%",
    mode: "return",
    scale: 0.01,
  },
  vix: {
    symbol: "^VIX",
    label: "VIX",
    unit: "points",
    mode: "level",
    scale: 1,
  },
  equity: {
    symbol: "^GSPC",
    label: "S&P 500",
    unit: "%",
    mode: "return",
    scale: 0.01,
  },
} as const;
export type ShockDriver = keyof typeof shockDrivers;
export const shockDriverKeys = Object.keys(shockDrivers) as [
  ShockDriver,
  ...ShockDriver[],
];

/** Per-day change of a driver series: absolute for levels (yields, VIX), relative for prices. */
export function driverChanges(
  closes: (number | null)[],
  mode: "level" | "return",
) {
  const out: (number | null)[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const next = closes[i];
    out.push(
      prev == null || next == null
        ? null
        : mode === "level"
          ? next - prev
          : prev
            ? next / prev - 1
            : null,
    );
  }
  return out;
}

export function univariateBeta(y: (number | null)[], x: (number | null)[]) {
  const ys: number[] = [];
  const xs: number[][] = [];
  for (let t = 0; t < y.length; t++) {
    const a = y[t];
    const b = x[t];
    if (a == null || b == null) continue;
    ys.push(a);
    xs.push([b]);
  }
  const fit = ols(ys, xs);
  return fit
    ? {
        beta: fit.coefficients[1],
        r2: fit.r2,
        t: fit.tStats[1],
        observations: fit.observations,
      }
    : null;
}
