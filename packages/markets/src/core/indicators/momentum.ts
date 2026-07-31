import { ema, type Line } from "./moving-averages";

export function rsi(values: number[], period = 14): Line {
  const out: Line = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = (values[i] as number) - (values[i - 1] as number);
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = (values[i] as number) - (values[i - 1] as number);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export interface MacdResult {
  macd: Line;
  signal: Line;
  histogram: Line;
}

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line: Line = values.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f === null || f === undefined || s === null || s === undefined
      ? null
      : f - s;
  });

  // The signal EMA is seeded from where the MACD line actually starts, so its
  // warm-up is not silently shifted by the slow EMA's own warm-up.
  const firstIndex = line.findIndex((v) => v !== null);
  const signal: Line = new Array(values.length).fill(null);
  const histogram: Line = new Array(values.length).fill(null);
  if (firstIndex === -1) return { macd: line, signal, histogram };

  const dense = line.slice(firstIndex) as number[];
  const denseSignal = ema(dense, signalPeriod);
  for (let i = 0; i < denseSignal.length; i++) {
    const s = denseSignal[i];
    if (s === null || s === undefined) continue;
    const index = firstIndex + i;
    signal[index] = s;
    histogram[index] = (line[index] as number) - s;
  }
  return { macd: line, signal, histogram };
}

export interface StochasticResult {
  k: Line;
  d: Line;
}

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
  smoothD = 3,
): StochasticResult {
  const k: Line = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    for (let j = i - period + 1; j <= i; j++) {
      if ((highs[j] as number) > highest) highest = highs[j] as number;
      if ((lows[j] as number) < lowest) lowest = lows[j] as number;
    }
    const range = highest - lowest;
    k[i] = range === 0 ? 50 : (((closes[i] as number) - lowest) / range) * 100;
  }

  const d: Line = new Array(closes.length).fill(null);
  for (let i = 0; i < k.length; i++) {
    if (i < period - 1 + smoothD - 1) continue;
    let sum = 0;
    let count = 0;
    for (let j = i - smoothD + 1; j <= i; j++) {
      const value = k[j];
      if (value === null || value === undefined) continue;
      sum += value;
      count++;
    }
    if (count === smoothD) d[i] = sum / smoothD;
  }
  return { k, d };
}
