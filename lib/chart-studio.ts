import {
  cci,
  ema,
  rsi,
  sma,
  stdev,
  trueRange,
  williams,
  type Bar,
} from "./indicators";
import type {
  ChartPoint,
  CustomAverage,
  CustomPane,
  DrawingKind,
  OscillatorKind,
} from "./models";

type Series = (number | null)[];

export function wma(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const weight = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let valid = true;
    for (let j = 0; j < period; j++) {
      const value = values[i - j];
      if (value == null) {
        valid = false;
        break;
      }
      sum += value * (period - j);
    }
    if (valid) out[i] = sum / weight;
  }
  return out;
}

/** Hull moving average: WMA(2·WMA(n/2) − WMA(n), √n). */
export function hma(values: Series, period: number): Series {
  const half = wma(values, Math.max(1, Math.round(period / 2)));
  const full = wma(values, period);
  const diff = half.map((value, i) => {
    const other = full[i];
    return value == null || other == null ? null : 2 * value - other;
  });
  return wma(diff, Math.max(1, Math.round(Math.sqrt(period))));
}

const sources: Record<CustomAverage["source"], (bar: Bar) => number> = {
  close: (bar) => bar.close,
  hl2: (bar) => (bar.high + bar.low) / 2,
  hlc3: (bar) => (bar.high + bar.low + bar.close) / 3,
  ohlc4: (bar) => (bar.open + bar.high + bar.low + bar.close) / 4,
};

export const averageKey = (index: number) =>
  `avg${index}`;
export const averageLabel = (average: CustomAverage) =>
  `${average.kind.toUpperCase()} ${average.period}${average.source === "close" ? "" : ` ${average.source}`}`;

export function computeAverages(bars: Bar[], averages: CustomAverage[]) {
  return averages.map((average) => {
    const input = bars.map(sources[average.source]);
    switch (average.kind) {
      case "ema":
        return ema(input, average.period);
      case "wma":
        return wma(input, average.period);
      case "hma":
        return hma(input, average.period);
      default:
        return sma(input, average.period);
    }
  });
}

/**
 * Aligns a comparison series to the main series' timestamps (last value on
 * or before each bar) and rebases it to start at `base`.
 */
export function rebaseOnto(
  main: { time: number }[],
  other: ChartPoint[],
  base: number,
): Series {
  if (!other.length || !main.length) return main.map(() => null);
  const aligned: Series = [];
  let cursor = 0;
  let last: number | null = null;
  for (const bar of main) {
    while (cursor < other.length && other[cursor].time <= bar.time + 43200) {
      last = other[cursor].close;
      cursor++;
    }
    aligned.push(last);
  }
  const anchor = aligned.find((value) => value != null);
  if (anchor == null || anchor === 0) return aligned;
  return aligned.map((value) => (value == null ? null : (value / anchor) * base));
}

export const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];

export const toolPoints: Record<DrawingKind, number> = {
  trend: 2,
  ray: 2,
  hline: 1,
  vline: 1,
  rect: 2,
  fib: 2,
  channel: 3,
  text: 1,
};

export const toolLabels: Record<DrawingKind, string> = {
  trend: "Trend line",
  ray: "Ray",
  hline: "Horizontal line",
  vline: "Vertical line",
  rect: "Rectangle",
  fib: "Fibonacci retracement",
  channel: "Parallel channel",
  text: "Text note",
};

export const drawingPalette = [
  "#e0a030",
  "#3f8fd8",
  "#d0503c",
  "#3aa776",
  "#a565c9",
  "#9aa49d",
];

/** Index of the bar nearest to `time` (bars sorted ascending). */
export function nearestIndex(times: number[], time: number) {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - time) < Math.abs(times[lo] - time))
    return lo - 1;
  return lo;
}

const paneLabels: Record<OscillatorKind, string> = {
  rsi: "RSI",
  roc: "ROC",
  zscore: "Z-score",
  atr: "ATR",
  stdev: "StdDev",
  williams: "%R",
  cci: "CCI",
};
export const paneLabel = (pane: CustomPane) => `${paneLabels[pane.kind]} ${pane.period}`;
export const paneKey = (index: number) => `osc${index}`;

/** Reference levels and fixed domains that make each oscillator readable. */
export const paneGuides: Record<
  OscillatorKind,
  { levels?: number[]; domain?: [number, number] }
> = {
  rsi: { levels: [70, 30], domain: [0, 100] },
  roc: { levels: [0] },
  zscore: { levels: [2, 0, -2] },
  atr: {},
  stdev: {},
  williams: { levels: [-20, -80], domain: [-100, 0] },
  cci: { levels: [100, -100] },
};

export function computePanes(bars: Bar[], panes: CustomPane[]) {
  const closes = bars.map((bar) => bar.close);
  return panes.map((pane): (number | null)[] => {
    const n = pane.period;
    switch (pane.kind) {
      case "rsi":
        return rsi(closes, n);
      case "roc":
        return closes.map((close, i) =>
          i >= n && closes[i - n] ? (close / closes[i - n] - 1) * 100 : null,
        );
      case "zscore": {
        const mean = sma(closes, n);
        const deviation = stdev(closes, n, mean);
        return closes.map((close, i) => {
          const m = mean[i];
          const d = deviation[i];
          return m == null || !d ? null : (close - m) / d;
        });
      }
      case "stdev": {
        const returns = closes.map((close, i) =>
          i > 0 && closes[i - 1] ? (close / closes[i - 1] - 1) * 100 : null,
        );
        return stdev(returns, n, sma(returns, n));
      }
      case "atr":
        return sma(trueRange(bars), n);
      case "williams":
        return williams(bars, n);
      case "cci":
        return cci(bars, n);
    }
  });
}
