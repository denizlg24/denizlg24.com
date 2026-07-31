export const TRADING_DAYS_PER_YEAR = 252;

export function simpleReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1] as number;
    out.push(prev === 0 ? 0 : ((values[i] as number) - prev) / prev);
  }
  return out;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Sample standard deviation — these are return samples, not a population. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  let variance = 0;
  for (const value of values) {
    const diff = value - average;
    variance += diff * diff;
  }
  return Math.sqrt(variance / (values.length - 1));
}

export function annualizedVolatility(
  returns: number[],
  periodsPerYear = TRADING_DAYS_PER_YEAR,
): number | null {
  if (returns.length < 2) return null;
  return stdev(returns) * Math.sqrt(periodsPerYear);
}

export function cagr(
  startValue: number,
  endValue: number,
  years: number,
): number | null {
  if (startValue <= 0 || years <= 0) return null;
  // A wiped-out portfolio has no real growth rate; -100% is the honest answer.
  if (endValue <= 0) return -1;
  return (endValue / startValue) ** (1 / years) - 1;
}

export interface DrawdownResult {
  /** Positive fraction, e.g. 0.32 for a 32% peak-to-trough fall. */
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
}

export function maxDrawdown(values: number[]): DrawdownResult | null {
  if (values.length === 0) return null;
  let peak = values[0] as number;
  let peakIndex = 0;
  let worst = 0;
  let worstPeak = 0;
  let worstTrough = 0;

  for (let i = 1; i < values.length; i++) {
    const value = values[i] as number;
    if (value > peak) {
      peak = value;
      peakIndex = i;
      continue;
    }
    if (peak <= 0) continue;
    const drawdown = (peak - value) / peak;
    if (drawdown > worst) {
      worst = drawdown;
      worstPeak = peakIndex;
      worstTrough = i;
    }
  }
  return { maxDrawdown: worst, peakIndex: worstPeak, troughIndex: worstTrough };
}

export function sharpe(
  returns: number[],
  riskFreeAnnual = 0,
  periodsPerYear = TRADING_DAYS_PER_YEAR,
): number | null {
  if (returns.length < 2) return null;
  const deviation = stdev(returns);
  if (deviation === 0) return null;
  const excessAnnual = mean(returns) * periodsPerYear - riskFreeAnnual;
  return excessAnnual / (deviation * Math.sqrt(periodsPerYear));
}

export function sortino(
  returns: number[],
  riskFreeAnnual = 0,
  periodsPerYear = TRADING_DAYS_PER_YEAR,
): number | null {
  if (returns.length < 2) return null;
  const target = riskFreeAnnual / periodsPerYear;
  let downsideSum = 0;
  for (const value of returns) {
    if (value < target) {
      const shortfall = target - value;
      downsideSum += shortfall * shortfall;
    }
  }
  // Divided by the full count, not just the losing periods: the standard
  // definition treats upside as zero downside rather than dropping it.
  const downsideDeviation = Math.sqrt(downsideSum / returns.length);
  if (downsideDeviation === 0) return null;
  const excessAnnual = mean(returns) * periodsPerYear - riskFreeAnnual;
  return excessAnnual / (downsideDeviation * Math.sqrt(periodsPerYear));
}

export function beta(returns: number[], benchmark: number[]): number | null {
  const length = Math.min(returns.length, benchmark.length);
  if (length < 2) return null;
  const a = returns.slice(returns.length - length);
  const b = benchmark.slice(benchmark.length - length);
  const meanA = mean(a);
  const meanB = mean(b);
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < length; i++) {
    const diffB = (b[i] as number) - meanB;
    covariance += ((a[i] as number) - meanA) * diffB;
    variance += diffB * diffB;
  }
  if (variance === 0) return null;
  return covariance / variance;
}

/** Jensen's alpha, annualised. */
export function alpha(
  returns: number[],
  benchmark: number[],
  riskFreeAnnual = 0,
  periodsPerYear = TRADING_DAYS_PER_YEAR,
): number | null {
  const b = beta(returns, benchmark);
  if (b === null) return null;
  const portfolioAnnual = mean(returns) * periodsPerYear;
  const benchmarkAnnual = mean(benchmark) * periodsPerYear;
  return (
    portfolioAnnual - (riskFreeAnnual + b * (benchmarkAnnual - riskFreeAnnual))
  );
}
