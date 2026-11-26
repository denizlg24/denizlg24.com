import { z } from "zod";

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};
type Series = (number | null)[];

export const studyKeys = [
  "sma20",
  "sma50",
  "sma100",
  "sma200",
  "ema9",
  "ema21",
  "ema50",
  "bollinger",
  "keltner",
  "donchian",
  "vwap",
  "psar",
  "ichimoku",
  "prevClose",
  "volume",
  "rsi",
  "macd",
  "stoch",
  "atr",
  "adx",
  "obv",
  "cci",
  "williams",
  "mfi",
] as const;
export type StudyKey = (typeof studyKeys)[number];
export const studyKeySchema = z.enum(studyKeys);

export type StudyInfo = {
  key: StudyKey;
  label: string;
  short: string;
  description: string;
  pane: "price" | "volume" | "lower";
  group: "Moving averages" | "Bands & channels" | "Overlays" | "Oscillators";
  lookback: number;
};

export const studies: StudyInfo[] = [
  {
    key: "sma20",
    label: "SMA 20",
    short: "SMA20",
    description: "20-bar simple moving average",
    pane: "price",
    group: "Moving averages",
    lookback: 20,
  },
  {
    key: "sma50",
    label: "SMA 50",
    short: "SMA50",
    description: "50-bar simple moving average",
    pane: "price",
    group: "Moving averages",
    lookback: 50,
  },
  {
    key: "sma100",
    label: "SMA 100",
    short: "SMA100",
    description: "100-bar simple moving average",
    pane: "price",
    group: "Moving averages",
    lookback: 100,
  },
  {
    key: "sma200",
    label: "SMA 200",
    short: "SMA200",
    description: "200-bar simple moving average",
    pane: "price",
    group: "Moving averages",
    lookback: 200,
  },
  {
    key: "ema9",
    label: "EMA 9",
    short: "EMA9",
    description: "9-bar exponential moving average",
    pane: "price",
    group: "Moving averages",
    lookback: 27,
  },
  {
    key: "ema21",
    label: "EMA 21",
    short: "EMA21",
    description: "21-bar exponential moving average",
    pane: "price",
    group: "Moving averages",
    lookback: 63,
  },
  {
    key: "ema50",
    label: "EMA 50",
    short: "EMA50",
    description: "50-bar exponential moving average",
    pane: "price",
    group: "Moving averages",
    lookback: 150,
  },
  {
    key: "bollinger",
    label: "Bollinger Bands",
    short: "BB(20,2)",
    description: "20-bar SMA ± 2 standard deviations",
    pane: "price",
    group: "Bands & channels",
    lookback: 20,
  },
  {
    key: "keltner",
    label: "Keltner Channels",
    short: "KC(20,2)",
    description: "20-bar EMA ± 2 × ATR(10)",
    pane: "price",
    group: "Bands & channels",
    lookback: 60,
  },
  {
    key: "donchian",
    label: "Donchian Channels",
    short: "DC(20)",
    description: "Highest high and lowest low of 20 bars",
    pane: "price",
    group: "Bands & channels",
    lookback: 20,
  },
  {
    key: "ichimoku",
    label: "Ichimoku Cloud",
    short: "Ichimoku",
    description: "Conversion (9), base (26) and leading span cloud (52)",
    pane: "price",
    group: "Bands & channels",
    lookback: 78,
  },
  {
    key: "vwap",
    label: "VWAP",
    short: "VWAP",
    description: "Volume-weighted average price, anchored to each session",
    pane: "price",
    group: "Overlays",
    lookback: 0,
  },
  {
    key: "psar",
    label: "Parabolic SAR",
    short: "SAR",
    description: "Stop and reverse (0.02, 0.2)",
    pane: "price",
    group: "Overlays",
    lookback: 10,
  },
  {
    key: "prevClose",
    label: "Previous close",
    short: "Prev",
    description: "Prior session close as a reference line",
    pane: "price",
    group: "Overlays",
    lookback: 0,
  },
  {
    key: "volume",
    label: "Volume",
    short: "Vol",
    description: "Bar volume with its 20-bar average",
    pane: "volume",
    group: "Oscillators",
    lookback: 20,
  },
  {
    key: "rsi",
    label: "RSI 14",
    short: "RSI",
    description: "Relative strength index (Wilder, 14)",
    pane: "lower",
    group: "Oscillators",
    lookback: 60,
  },
  {
    key: "macd",
    label: "MACD",
    short: "MACD",
    description: "12/26 EMA difference with a 9-bar signal",
    pane: "lower",
    group: "Oscillators",
    lookback: 100,
  },
  {
    key: "stoch",
    label: "Stochastic",
    short: "Stoch",
    description: "Slow stochastic %K(14,3) and %D(3)",
    pane: "lower",
    group: "Oscillators",
    lookback: 20,
  },
  {
    key: "atr",
    label: "ATR 14",
    short: "ATR",
    description: "Average true range (Wilder, 14)",
    pane: "lower",
    group: "Oscillators",
    lookback: 60,
  },
  {
    key: "adx",
    label: "ADX 14",
    short: "ADX",
    description: "Average directional index with +DI and −DI",
    pane: "lower",
    group: "Oscillators",
    lookback: 80,
  },
  {
    key: "obv",
    label: "On-balance volume",
    short: "OBV",
    description: "Cumulative volume signed by close direction",
    pane: "lower",
    group: "Oscillators",
    lookback: 0,
  },
  {
    key: "cci",
    label: "CCI 20",
    short: "CCI",
    description: "Commodity channel index (20)",
    pane: "lower",
    group: "Oscillators",
    lookback: 20,
  },
  {
    key: "williams",
    label: "Williams %R",
    short: "%R",
    description: "Williams percent range (14)",
    pane: "lower",
    group: "Oscillators",
    lookback: 14,
  },
  {
    key: "mfi",
    label: "Money flow index",
    short: "MFI",
    description: "Volume-weighted RSI (14)",
    pane: "lower",
    group: "Oscillators",
    lookback: 15,
  },
];

export const studyInfo = new Map(studies.map((item) => [item.key, item]));

export function sma(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value == null) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += value;
    count++;
    if (count > period) {
      sum -= values[i - period] as number;
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  let seeded = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value == null) continue;
    if (prev == null) {
      seed += value;
      seeded++;
      if (seeded === period) {
        prev = seed / period;
        out[i] = prev;
      }
      continue;
    }
    prev = value * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function wilder(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let prev: number | null = null;
  let seed = 0;
  let seeded = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value == null) continue;
    if (prev == null) {
      seed += value;
      seeded++;
      if (seeded === period) {
        prev = seed / period;
        out[i] = prev;
      }
      continue;
    }
    prev = (prev * (period - 1) + value) / period;
    out[i] = prev;
  }
  return out;
}

function rolling(
  bars: Bar[],
  period: number,
  pick: (window: Bar[]) => number,
): Series {
  return bars.map((_, i) =>
    i + 1 < period ? null : pick(bars.slice(i + 1 - period, i + 1)),
  );
}
const highest = (window: Bar[]) => Math.max(...window.map((bar) => bar.high));
const lowest = (window: Bar[]) => Math.min(...window.map((bar) => bar.low));

export function stdev(values: Series, period: number, mean: Series): Series {
  return values.map((_, i) => {
    const average = mean[i];
    if (average == null || i + 1 < period) return null;
    let total = 0;
    for (let j = i + 1 - period; j <= i; j++)
      total += ((values[j] as number) - average) ** 2;
    return Math.sqrt(total / period);
  });
}

export function trueRange(bars: Bar[]): Series {
  return bars.map((bar, i) =>
    i === 0
      ? bar.high - bar.low
      : Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - bars[i - 1].close),
          Math.abs(bar.low - bars[i - 1].close),
        ),
  );
}

export function rsi(closes: Series, period = 14): Series {
  const gains: Series = closes.map((value, i) =>
    i === 0 || value == null || closes[i - 1] == null
      ? null
      : Math.max(0, value - (closes[i - 1] as number)),
  );
  const losses: Series = closes.map((value, i) =>
    i === 0 || value == null || closes[i - 1] == null
      ? null
      : Math.max(0, (closes[i - 1] as number) - value),
  );
  const up = wilder(gains, period);
  const down = wilder(losses, period);
  return up.map((gain, i) => {
    const loss = down[i];
    if (gain == null || loss == null) return null;
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  });
}

export function macd(closes: Series, fast = 12, slow = 26, signal = 9) {
  const fastLine = ema(closes, fast);
  const slowLine = ema(closes, slow);
  const line = fastLine.map((value, i) =>
    value == null || slowLine[i] == null ? null : value - slowLine[i],
  );
  const signalLine = ema(line, signal);
  const histogram = line.map((value, i) =>
    value == null || signalLine[i] == null ? null : value - signalLine[i],
  );
  return { line, signal: signalLine, histogram };
}

export function stochastic(bars: Bar[], period = 14, smoothK = 3, d = 3) {
  const raw = rolling(bars, period, (window) => {
    const high = highest(window);
    const low = lowest(window);
    const close = window[window.length - 1].close;
    return high === low ? 50 : ((close - low) / (high - low)) * 100;
  });
  const k = sma(raw, smoothK);
  return { k, d: sma(k, d) };
}

export function williams(bars: Bar[], period = 14): Series {
  return rolling(bars, period, (window) => {
    const high = highest(window);
    const low = lowest(window);
    const close = window[window.length - 1].close;
    return high === low ? -50 : ((high - close) / (high - low)) * -100;
  });
}

export function cci(bars: Bar[], period = 20): Series {
  const typical = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
  const mean = sma(typical, period);
  return typical.map((value, i) => {
    const average = mean[i];
    if (average == null) return null;
    let deviation = 0;
    for (let j = i + 1 - period; j <= i; j++)
      deviation += Math.abs(typical[j] - average);
    deviation /= period;
    return deviation === 0 ? 0 : (value - average) / (0.015 * deviation);
  });
}

export function obv(bars: Bar[]): Series {
  let total = 0;
  return bars.map((bar, i) => {
    if (i > 0) {
      const volume = bar.volume ?? 0;
      if (bar.close > bars[i - 1].close) total += volume;
      else if (bar.close < bars[i - 1].close) total -= volume;
    }
    return total;
  });
}

export function mfi(bars: Bar[], period = 14): Series {
  const typical = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
  return bars.map((_, i) => {
    if (i < period) return null;
    let positive = 0;
    let negative = 0;
    for (let j = i + 1 - period; j <= i; j++) {
      const flow = typical[j] * (bars[j].volume ?? 0);
      if (typical[j] > typical[j - 1]) positive += flow;
      else if (typical[j] < typical[j - 1]) negative += flow;
    }
    if (negative === 0) return positive === 0 ? 50 : 100;
    return 100 - 100 / (1 + positive / negative);
  });
}

export function adx(bars: Bar[], period = 14) {
  const plusDM: Series = bars.map((bar, i) => {
    if (i === 0) return null;
    const up = bar.high - bars[i - 1].high;
    const down = bars[i - 1].low - bar.low;
    return up > down && up > 0 ? up : 0;
  });
  const minusDM: Series = bars.map((bar, i) => {
    if (i === 0) return null;
    const up = bar.high - bars[i - 1].high;
    const down = bars[i - 1].low - bar.low;
    return down > up && down > 0 ? down : 0;
  });
  const range = trueRange(bars).map((value, i) => (i === 0 ? null : value));
  const tr = wilder(range, period);
  const plus = wilder(plusDM, period);
  const minus = wilder(minusDM, period);
  const plusDI = plus.map((value, i) =>
    value == null || !tr[i] ? null : (value / (tr[i] as number)) * 100,
  );
  const minusDI = minus.map((value, i) =>
    value == null || !tr[i] ? null : (value / (tr[i] as number)) * 100,
  );
  const dx = plusDI.map((value, i) => {
    const other = minusDI[i];
    if (value == null || other == null) return null;
    const total = value + other;
    return total === 0 ? 0 : (Math.abs(value - other) / total) * 100;
  });
  return { adx: wilder(dx, period), plusDI, minusDI };
}

export function psar(bars: Bar[], step = 0.02, max = 0.2): Series {
  if (bars.length < 2) return bars.map(() => null);
  const out: Series = [null];
  let rising = bars[1].close >= bars[0].close;
  let sar = rising ? bars[0].low : bars[0].high;
  let extreme = rising ? bars[0].high : bars[0].low;
  let factor = step;
  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    sar = sar + factor * (extreme - sar);
    if (rising) {
      sar = Math.min(sar, bars[i - 1].low, bars[Math.max(0, i - 2)].low);
      if (bar.low < sar) {
        rising = false;
        sar = extreme;
        extreme = bar.low;
        factor = step;
      } else if (bar.high > extreme) {
        extreme = bar.high;
        factor = Math.min(max, factor + step);
      }
    } else {
      sar = Math.max(sar, bars[i - 1].high, bars[Math.max(0, i - 2)].high);
      if (bar.high > sar) {
        rising = true;
        sar = extreme;
        extreme = bar.high;
        factor = step;
      } else if (bar.low < extreme) {
        extreme = bar.low;
        factor = Math.min(max, factor + step);
      }
    }
    out.push(sar);
  }
  return out;
}

const sessionKey = (time: number) =>
  new Date(time * 1000).toISOString().slice(0, 10);

export function vwap(bars: Bar[]): Series {
  let day = "";
  let volume = 0;
  let value = 0;
  return bars.map((bar) => {
    const key = sessionKey(bar.time);
    if (key !== day) {
      day = key;
      volume = 0;
      value = 0;
    }
    const traded = bar.volume ?? 0;
    volume += traded;
    value += ((bar.high + bar.low + bar.close) / 3) * traded;
    return volume ? value / volume : null;
  });
}

function midpoint(bars: Bar[], period: number): Series {
  return rolling(bars, period, (window) => (highest(window) + lowest(window)) / 2);
}

export function ichimoku(bars: Bar[]) {
  const conversion = midpoint(bars, 9);
  const base = midpoint(bars, 26);
  const leadA = conversion.map((value, i) =>
    value == null || base[i] == null ? null : (value + base[i]) / 2,
  );
  const leadB = midpoint(bars, 52);
  const shift = (values: Series) =>
    bars.map((_, i) => (i >= 26 ? values[i - 26] : null));
  return {
    conversion,
    base,
    spanA: shift(leadA),
    spanB: shift(leadB),
  };
}

export type StudyRow = Record<string, number | [number, number] | null>;

/**
 * Computes every requested study over the full bar set (warm-up included) so
 * long lookbacks such as SMA 200 are valid from the first visible bar.
 */
export function computeStudies(bars: Bar[], keys: StudyKey[]): StudyRow[] {
  const rows: StudyRow[] = bars.map(() => ({}));
  const closes = bars.map((bar) => bar.close);
  const set = (name: string, values: Series) =>
    values.forEach((value, i) => (rows[i][name] = value));
  const band = (name: string, lower: Series, upper: Series) =>
    lower.forEach((low, i) => {
      const high = upper[i];
      rows[i][name] = low == null || high == null ? null : [low, high];
    });
  for (const key of keys) {
    switch (key) {
      case "sma20":
      case "sma50":
      case "sma100":
      case "sma200":
        set(key, sma(closes, Number(key.slice(3))));
        break;
      case "ema9":
      case "ema21":
      case "ema50":
        set(key, ema(closes, Number(key.slice(3))));
        break;
      case "bollinger": {
        const mid = sma(closes, 20);
        const deviation = stdev(closes, 20, mid);
        const upper = mid.map((value, i) =>
          value == null || deviation[i] == null ? null : value + 2 * deviation[i],
        );
        const lower = mid.map((value, i) =>
          value == null || deviation[i] == null ? null : value - 2 * deviation[i],
        );
        set("bbMid", mid);
        set("bbUpper", upper);
        set("bbLower", lower);
        band("bbBand", lower, upper);
        break;
      }
      case "keltner": {
        const mid = ema(closes, 20);
        const range = wilder(trueRange(bars), 10);
        const upper = mid.map((value, i) =>
          value == null || range[i] == null ? null : value + 2 * range[i],
        );
        const lower = mid.map((value, i) =>
          value == null || range[i] == null ? null : value - 2 * range[i],
        );
        set("kcMid", mid);
        set("kcUpper", upper);
        set("kcLower", lower);
        break;
      }
      case "donchian": {
        const upper = rolling(bars, 20, highest);
        const lower = rolling(bars, 20, lowest);
        set("dcUpper", upper);
        set("dcLower", lower);
        band("dcBand", lower, upper);
        break;
      }
      case "ichimoku": {
        const cloud = ichimoku(bars);
        set("ichiConversion", cloud.conversion);
        set("ichiBase", cloud.base);
        set("ichiSpanA", cloud.spanA);
        set("ichiSpanB", cloud.spanB);
        band(
          "ichiCloud",
          cloud.spanA.map((a, i) =>
            a == null || cloud.spanB[i] == null
              ? null
              : Math.min(a, cloud.spanB[i]),
          ),
          cloud.spanA.map((a, i) =>
            a == null || cloud.spanB[i] == null
              ? null
              : Math.max(a, cloud.spanB[i]),
          ),
        );
        break;
      }
      case "vwap":
        set("vwap", vwap(bars));
        break;
      case "psar":
        set("psar", psar(bars));
        break;
      case "volume":
        set("volumeAvg", sma(bars.map((bar) => bar.volume), 20));
        break;
      case "rsi":
        set("rsi", rsi(closes));
        break;
      case "macd": {
        const result = macd(closes);
        set("macd", result.line);
        set("macdSignal", result.signal);
        set("macdHist", result.histogram);
        break;
      }
      case "stoch": {
        const result = stochastic(bars);
        set("stochK", result.k);
        set("stochD", result.d);
        break;
      }
      case "atr":
        set("atr", wilder(trueRange(bars), 14));
        break;
      case "adx": {
        const result = adx(bars);
        set("adx", result.adx);
        set("plusDI", result.plusDI);
        set("minusDI", result.minusDI);
        break;
      }
      case "obv":
        set("obv", obv(bars));
        break;
      case "cci":
        set("cci", cci(bars));
        break;
      case "williams":
        set("williams", williams(bars));
        break;
      case "mfi":
        set("mfi", mfi(bars));
        break;
      case "prevClose":
        break;
    }
  }
  return rows;
}

export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const [i, bar] of bars.entries()) {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open =
      i === 0
        ? (bar.open + bar.close) / 2
        : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      ...bar,
      open,
      close,
      high: Math.max(bar.high, open, close),
      low: Math.min(bar.low, open, close),
    });
  }
  return out;
}
