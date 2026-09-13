import {
  atr,
  bollinger,
  ema,
  macd,
  maxDrawdown,
  rsi,
  sma,
} from "@repo/markets/core";
import { getStores } from "@/lib/markets/service";

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null;
  return round(((to - from) / from) * 100);
}

function latest(line: (number | null)[]): number | null {
  for (let index = line.length - 1; index >= 0; index--) {
    const value = line[index];
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      return round(value);
    }
  }
  return null;
}

/**
 * Indicator readings from the cached daily bars only — no provider request.
 * `null` when nothing is cached yet; fetching candles backfills them.
 */
export async function computeTechnicals(ticker: string) {
  const bars = await getStores().bars.getDailyBars(ticker);
  if (bars.length === 0) return null;
  const closes = bars.map((bar) => bar.adjClose);
  const highs = bars.map((bar) => bar.adjHigh);
  const lows = bars.map((bar) => bar.adjLow);
  const last = closes.at(-1) ?? 0;
  const macdResult = macd(closes);
  const bands = bollinger(closes, 20, 2);
  const trailing = (back: number) => {
    const prior = closes[closes.length - 1 - back];
    return prior === undefined ? null : percentChange(prior, last);
  };
  return {
    ticker,
    asOf: bars.at(-1)?.date ?? null,
    barCount: bars.length,
    close: round(last),
    rsi14: latest(rsi(closes, 14)),
    macd: {
      macd: latest(macdResult.macd),
      signal: latest(macdResult.signal),
      histogram: latest(macdResult.histogram),
    },
    sma: {
      20: latest(sma(closes, 20)),
      50: latest(sma(closes, 50)),
      200: latest(sma(closes, 200)),
    },
    ema: { 12: latest(ema(closes, 12)), 26: latest(ema(closes, 26)) },
    bollinger: {
      upper: latest(bands.upper),
      middle: latest(bands.middle),
      lower: latest(bands.lower),
    },
    atr14: latest(atr(highs, lows, closes, 14)),
    trailingReturnPercent: {
      week: trailing(5),
      month: trailing(21),
      quarter: trailing(63),
      year: trailing(252),
    },
    maxDrawdownPercent: round((maxDrawdown(closes)?.maxDrawdown ?? 0) * -100),
  };
}
