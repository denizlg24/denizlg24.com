import { rsi, sma, type Bar } from "./indicators";
import type { ChartPoint } from "./models";

export const TRADING_DAYS = 252;

const dayKey = (time: number) => Math.floor(time / 86400);

export function returns(closes: number[]) {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++)
    out.push(closes[i - 1] ? closes[i] / closes[i - 1] - 1 : 0);
  return out;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const variance = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
};
export const stdev = (values: number[]) => Math.sqrt(variance(values));

/** Annualised realised volatility over a trailing window, per bar. */
export function rollingVolatility(points: ChartPoint[], window: number) {
  const r = returns(points.map((point) => point.close)).map((value) =>
    Math.log(1 + value),
  );
  return points.map((point, i) => {
    if (i < window) return { time: point.time, value: null };
    return {
      time: point.time,
      value: stdev(r.slice(i - window, i)) * Math.sqrt(TRADING_DAYS) * 100,
    };
  });
}

/** Parkinson high/low estimator, annualised, over a trailing window. */
export function parkinson(points: ChartPoint[], window: number) {
  const factor = 1 / (4 * Math.log(2));
  return points.map((point, i) => {
    if (i < window - 1) return { time: point.time, value: null };
    const slice = points.slice(i - window + 1, i + 1);
    const sum = slice.reduce(
      (total, bar) => total + Math.log(bar.high / bar.low) ** 2,
      0,
    );
    return {
      time: point.time,
      value: Math.sqrt((factor * sum) / window) * Math.sqrt(TRADING_DAYS) * 100,
    };
  });
}

/** Joins two price series on calendar day; returns paired closes. */
export function align(a: ChartPoint[], b: ChartPoint[]) {
  const right = new Map(b.map((point) => [dayKey(point.time), point.close]));
  const pairs: { time: number; a: number; b: number }[] = [];
  for (const point of a) {
    const other = right.get(dayKey(point.time));
    if (other != null) pairs.push({ time: point.time, a: point.close, b: other });
  }
  return pairs;
}

export type Regression = {
  beta: number;
  alpha: number;
  r2: number;
  correlation: number;
  standardError: number;
  observations: number;
  points: { x: number; y: number; time: number }[];
};

/**
 * OLS of the security's returns on the benchmark's, over `step`-bar returns
 * (1 = daily, 5 = weekly). Alpha is annualised.
 */
export function regression(
  security: ChartPoint[],
  benchmark: ChartPoint[],
  step = 1,
): Regression | null {
  const pairs = align(security, benchmark).filter((_, i) => i % step === 0);
  if (pairs.length < 12) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  const points: Regression["points"] = [];
  for (let i = 1; i < pairs.length; i++) {
    const x = pairs[i].b / pairs[i - 1].b - 1;
    const y = pairs[i].a / pairs[i - 1].a - 1;
    xs.push(x);
    ys.push(y);
    points.push({ x: x * 100, y: y * 100, time: pairs[i].time });
  }
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx || !syy) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const correlation = sxy / Math.sqrt(sxx * syy);
  const residual = ys.reduce(
    (sum, y, i) => sum + (y - alpha - beta * xs[i]) ** 2,
    0,
  );
  const periods = TRADING_DAYS / step;
  return {
    beta,
    alpha: alpha * periods * 100,
    r2: correlation ** 2,
    correlation,
    standardError: Math.sqrt(residual / Math.max(1, xs.length - 2) / sxx),
    observations: xs.length,
    points,
  };
}

/** Beta over a trailing window, per bar. */
export function rollingBeta(
  security: ChartPoint[],
  benchmark: ChartPoint[],
  window: number,
) {
  const pairs = align(security, benchmark);
  const out: { time: number; beta: number | null; correlation: number | null }[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    xs.push(pairs[i].b / pairs[i - 1].b - 1);
    ys.push(pairs[i].a / pairs[i - 1].a - 1);
    if (xs.length < window) {
      out.push({ time: pairs[i].time, beta: null, correlation: null });
      continue;
    }
    const x = xs.slice(-window);
    const y = ys.slice(-window);
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let j = 0; j < window; j++) {
      sxy += (x[j] - mx) * (y[j] - my);
      sxx += (x[j] - mx) ** 2;
      syy += (y[j] - my) ** 2;
    }
    out.push({
      time: pairs[i].time,
      beta: sxx ? sxy / sxx : null,
      correlation: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null,
    });
  }
  return out;
}

/** Pearson correlation of daily returns for every pair. */
export function correlationMatrix(series: { symbol: string; points: ChartPoint[] }[]) {
  const keys = series.map((item) => new Map(item.points.map((point) => [dayKey(point.time), point.close])));
  const days = [...keys[0]?.keys() ?? []].filter((day) => keys.every((map) => map.has(day))).sort((a, b) => a - b);
  const r = keys.map((map) => returns(days.map((day) => map.get(day)!)));
  const matrix = r.map((a) =>
    r.map((b) => {
      const ma = mean(a);
      const mb = mean(b);
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (let i = 0; i < a.length; i++) {
        sab += (a[i] - ma) * (b[i] - mb);
        saa += (a[i] - ma) ** 2;
        sbb += (b[i] - mb) ** 2;
      }
      return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
    }),
  );
  const vol = r.map((values) => stdev(values) * Math.sqrt(TRADING_DAYS) * 100);
  const total = keys.map((map) => {
    const first = map.get(days[0]);
    const last = map.get(days.at(-1)!);
    return first && last ? (last / first - 1) * 100 : null;
  });
  return { matrix, observations: days.length, vol, total };
}

export type Seasonality = {
  years: { year: number; months: (number | null)[]; total: number | null }[];
  average: (number | null)[];
  median: (number | null)[];
  hitRate: (number | null)[];
};

/** Calendar-month returns by year, from daily or monthly bars. */
export function seasonality(points: ChartPoint[]): Seasonality {
  const lastClose = new Map<string, number>();
  for (const point of points) {
    const date = new Date(point.time * 1000);
    lastClose.set(`${date.getUTCFullYear()}-${date.getUTCMonth()}`, point.close);
  }
  const keys = [...lastClose.keys()];
  const years = [...new Set(keys.map((key) => Number(key.split("-")[0])))].sort();
  const monthly = new Map<string, number>();
  for (const key of keys) {
    const [year, month] = key.split("-").map(Number);
    const prior = month === 0 ? `${year - 1}-11` : `${year}-${month - 1}`;
    const before = lastClose.get(prior);
    if (before) monthly.set(key, (lastClose.get(key)! / before - 1) * 100);
  }
  const rows = years.map((year) => {
    const months = Array.from({ length: 12 }, (_, month) => monthly.get(`${year}-${month}`) ?? null);
    const valid = months.filter((value): value is number => value != null);
    const total = valid.length
      ? (valid.reduce((product, value) => product * (1 + value / 100), 1) - 1) * 100
      : null;
    return { year, months, total };
  });
  const column = (month: number) =>
    rows
      .map((row) => row.months[month])
      .filter((value): value is number => value != null);
  const median = (values: number[]) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return {
    years: rows.reverse(),
    average: Array.from({ length: 12 }, (_, month) => {
      const values = column(month);
      return values.length ? mean(values) : null;
    }),
    median: Array.from({ length: 12 }, (_, month) => median(column(month))),
    hitRate: Array.from({ length: 12 }, (_, month) => {
      const values = column(month);
      return values.length
        ? (values.filter((value) => value > 0).length / values.length) * 100
        : null;
    }),
  };
}

export function drawdowns(closes: number[]) {
  let peak = -Infinity;
  return closes.map((close) => {
    peak = Math.max(peak, close);
    return peak > 0 ? (close / peak - 1) * 100 : 0;
  });
}

export const strategyKinds = ["smaCross", "rsi", "breakout", "momentum", "hold"] as const;
export type StrategyKind = (typeof strategyKinds)[number];
export type Strategy = {
  kind: StrategyKind;
  fast: number;
  slow: number;
  lower: number;
  upper: number;
  shorts: boolean;
  costBps: number;
};
export const strategyLabels: Record<StrategyKind, string> = {
  smaCross: "Moving-average crossover",
  rsi: "RSI mean reversion",
  breakout: "Donchian breakout",
  momentum: "Time-series momentum",
  hold: "Buy and hold",
};

export type Trade = {
  side: "long" | "short";
  entry: number;
  exit: number | null;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
};

export type BacktestStats = {
  totalReturn: number;
  cagr: number;
  volatility: number;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number;
  calmar: number | null;
  exposure: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  averageTrade: number | null;
};

/** Target position (−1, 0, 1) for each bar, decided at that bar's close. */
function signals(bars: Bar[], strategy: Strategy): number[] {
  const closes = bars.map((bar) => bar.close);
  const short = strategy.shorts ? -1 : 0;
  switch (strategy.kind) {
    case "hold":
      return closes.map(() => 1);
    case "smaCross": {
      const fast = sma(closes, strategy.fast);
      const slow = sma(closes, strategy.slow);
      return closes.map((_, i) => {
        const f = fast[i];
        const s = slow[i];
        if (f == null || s == null) return 0;
        return f > s ? 1 : short;
      });
    }
    case "rsi": {
      const values = rsi(closes, strategy.fast);
      let position = 0;
      return closes.map((_, i) => {
        const value = values[i];
        if (value == null) return 0;
        if (value < strategy.lower) position = 1;
        else if (value > strategy.upper) position = short;
        else if (position === 1 && value > 50) position = 0;
        else if (position === -1 && value < 50) position = 0;
        return position;
      });
    }
    case "breakout": {
      let position = 0;
      return bars.map((bar, i) => {
        if (i < strategy.fast) return 0;
        const prior = bars.slice(i - strategy.fast, i);
        const high = Math.max(...prior.map((item) => item.high));
        const low = Math.min(...prior.map((item) => item.low));
        const exitWindow = bars.slice(Math.max(0, i - strategy.slow), i);
        const exitLow = Math.min(...exitWindow.map((item) => item.low));
        const exitHigh = Math.max(...exitWindow.map((item) => item.high));
        if (bar.close > high) position = 1;
        else if (bar.close < low) position = short;
        else if (position === 1 && bar.close < exitLow) position = 0;
        else if (position === -1 && bar.close > exitHigh) position = 0;
        return position;
      });
    }
    case "momentum":
      return closes.map((close, i) => {
        if (i < strategy.slow) return 0;
        return close > closes[i - strategy.slow] ? 1 : short;
      });
  }
}

/**
 * Close-to-close backtest: a signal at bar i's close is held over bar i+1.
 * Costs are charged on every change in position, in basis points of notional.
 */
export function backtest(bars: Bar[], strategy: Strategy) {
  const target = signals(bars, strategy);
  const equity: { time: number; strategy: number; hold: number; position: number; drawdown: number }[] = [];
  const trades: Trade[] = [];
  const daily: number[] = [];
  let value = 1;
  let position = 0;
  let peak = 1;
  let open: Trade | null = null;
  let held = 0;
  const first = bars[0]?.close ?? 1;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      const change = bars[i].close / bars[i - 1].close - 1;
      const result = position * change;
      value *= 1 + result;
      daily.push(result);
      if (position) held++;
    }
    const next = target[i];
    if (next !== position) {
      value *= 1 - (Math.abs(next - position) * strategy.costBps) / 10000;
      if (open) {
        open.exit = bars[i].time;
        open.exitPrice = bars[i].close;
        open.pnl =
          (open.side === "long" ? 1 : -1) * (bars[i].close / open.entryPrice - 1) * 100;
        trades.push(open);
        open = null;
      }
      if (next)
        open = {
          side: next > 0 ? "long" : "short",
          entry: bars[i].time,
          exit: null,
          entryPrice: bars[i].close,
          exitPrice: null,
          pnl: null,
        };
      position = next;
    }
    peak = Math.max(peak, value);
    equity.push({
      time: bars[i].time,
      strategy: (value - 1) * 100,
      hold: (bars[i].close / first - 1) * 100,
      position,
      drawdown: (value / peak - 1) * 100,
    });
  }
  if (open) {
    const last = bars.at(-1)!;
    open.pnl = (open.side === "long" ? 1 : -1) * (last.close / open.entryPrice - 1) * 100;
    trades.push(open);
  }
  const span = bars.length > 1 ? (bars.at(-1)!.time - bars[0].time) / (365.25 * 86400) : 0;
  const perYear = span > 0 ? (bars.length - 1) / span : TRADING_DAYS;
  const vol = stdev(daily) * Math.sqrt(perYear);
  const downside = Math.sqrt(
    mean(daily.map((value) => Math.min(0, value) ** 2)),
  ) * Math.sqrt(perYear);
  const cagr = span > 0 ? (value ** (1 / span) - 1) * 100 : 0;
  const maxDrawdown = Math.min(0, ...equity.map((row) => row.drawdown));
  const closed = trades.filter((trade) => trade.pnl != null);
  const wins = closed.filter((trade) => (trade.pnl ?? 0) > 0);
  const gains = wins.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const losses = closed
    .filter((trade) => (trade.pnl ?? 0) <= 0)
    .reduce((sum, trade) => sum + Math.abs(trade.pnl ?? 0), 0);
  const annualReturn = mean(daily) * perYear;
  const stats: BacktestStats = {
    totalReturn: (value - 1) * 100,
    cagr,
    volatility: vol * 100,
    sharpe: vol ? annualReturn / vol : null,
    sortino: downside ? annualReturn / downside : null,
    maxDrawdown,
    calmar: maxDrawdown ? cagr / Math.abs(maxDrawdown) : null,
    exposure: daily.length ? (held / daily.length) * 100 : 0,
    trades: trades.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    profitFactor: losses ? gains / losses : null,
    averageTrade: closed.length ? mean(closed.map((trade) => trade.pnl ?? 0)) : null,
  };
  return { equity, trades, stats };
}
