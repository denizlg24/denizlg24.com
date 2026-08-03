import type { Line } from "./moving-averages";

export function obv(closes: number[], volumes: number[]): number[] {
  const out: number[] = new Array(closes.length);
  if (closes.length === 0) return out;
  let running = 0;
  out[0] = 0;
  for (let i = 1; i < closes.length; i++) {
    const close = closes[i] as number;
    const prev = closes[i - 1] as number;
    if (close > prev) running += volumes[i] as number;
    else if (close < prev) running -= volumes[i] as number;
    out[i] = running;
  }
  return out;
}

/**
 * `sessionKeys` resets the cumulation — pass the date part of each bar's
 * timestamp for intraday VWAP. Omit it and the average runs from the first bar,
 * which is only meaningful on a daily series.
 */
export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  sessionKeys?: string[],
): Line {
  const out: Line = new Array(closes.length).fill(null);
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  let currentSession: string | undefined;

  for (let i = 0; i < closes.length; i++) {
    const session = sessionKeys?.[i];
    if (sessionKeys && session !== currentSession) {
      cumulativePV = 0;
      cumulativeVolume = 0;
      currentSession = session;
    }
    const typical =
      ((highs[i] as number) + (lows[i] as number) + (closes[i] as number)) / 3;
    const volume = volumes[i] as number;
    cumulativePV += typical * volume;
    cumulativeVolume += volume;
    out[i] = cumulativeVolume === 0 ? null : cumulativePV / cumulativeVolume;
  }
  return out;
}
