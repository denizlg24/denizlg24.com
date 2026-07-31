import { type Line, sma, wilderSmooth } from "./moving-averages";

export interface BollingerResult {
  middle: Line;
  upper: Line;
  lower: Line;
  /** (upper - lower) / middle — comparable across price levels. */
  bandwidth: Line;
}

export function bollinger(
  values: number[],
  period = 20,
  deviations = 2,
): BollingerResult {
  const middle = sma(values, period);
  const upper: Line = new Array(values.length).fill(null);
  const lower: Line = new Array(values.length).fill(null);
  const bandwidth: Line = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i] as number;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = (values[j] as number) - mean;
      variance += diff * diff;
    }
    // Population deviation: the window is the whole sample being described,
    // which is what every charting package draws.
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + deviations * sd;
    lower[i] = mean - deviations * sd;
    bandwidth[i] = mean === 0 ? null : (2 * deviations * sd) / mean;
  }
  return { middle, upper, lower, bandwidth };
}

export function trueRange(
  highs: number[],
  lows: number[],
  closes: number[],
): number[] {
  const out: number[] = new Array(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const high = highs[i] as number;
    const low = lows[i] as number;
    if (i === 0) {
      out[i] = high - low;
      continue;
    }
    const prevClose = closes[i - 1] as number;
    out[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
  }
  return out;
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): Line {
  return wilderSmooth(trueRange(highs, lows, closes), period);
}
