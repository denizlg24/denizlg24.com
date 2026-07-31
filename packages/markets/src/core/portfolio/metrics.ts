import type { PortfolioMetrics, Position, ValuationPoint } from "../../schemas";
import {
  alpha,
  annualizedVolatility,
  beta,
  cagr,
  maxDrawdown,
  sharpe,
  simpleReturns,
  sortino,
} from "../stats";
import type { ReplayState } from "./engine";

export interface BenchmarkPoint {
  date: string;
  value: number;
}

/**
 * Returns are computed on value net of contributions, so a deposit does not
 * register as a one-day gain. Without this a portfolio that adds cash monthly
 * shows a wildly overstated Sharpe.
 */
function contributionAdjustedReturns(curve: ValuationPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const previous = curve[i - 1] as ValuationPoint;
    const current = curve[i] as ValuationPoint;
    const flow = current.invested - previous.invested;
    if (previous.value === 0) {
      out.push(0);
      continue;
    }
    out.push((current.value - flow - previous.value) / previous.value);
  }
  return out;
}

function yearsBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

export function computeMetrics(options: {
  curve: ValuationPoint[];
  benchmarkCurve: BenchmarkPoint[];
  state: ReplayState;
  positions: Position[];
  riskFreeAnnual?: number;
}): PortfolioMetrics {
  const { curve, benchmarkCurve, state, positions } = options;
  const riskFree = options.riskFreeAnnual ?? 0;

  const last = curve.at(-1);
  const previous = curve.at(-2);
  const first = curve.at(0);

  const totalValue = last?.value ?? state.cash;
  const invested = last?.invested ?? state.invested;
  const totalPnl = totalValue - invested;
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );

  const returns = contributionAdjustedReturns(curve);
  const values = curve.map((point) => point.value);
  const drawdown = maxDrawdown(values);

  const benchmarkReturns = simpleReturns(
    benchmarkCurve.map((point) => point.value),
  );
  const benchmarkReturn =
    benchmarkCurve.length >= 2
      ? ((benchmarkCurve.at(-1) as BenchmarkPoint).value /
          (benchmarkCurve[0] as BenchmarkPoint).value -
          1) *
        100
      : null;

  const span =
    first && last && first.date !== last.date
      ? yearsBetween(first.date, last.date)
      : 0;

  const dayPnl =
    last && previous
      ? last.value - previous.value - (last.invested - previous.invested)
      : null;

  return {
    totalValue,
    cash: last?.cash ?? state.cash,
    invested,
    totalPnl,
    totalPnlPercent: invested === 0 ? 0 : (totalPnl / invested) * 100,
    dayPnl,
    dayPnlPercent:
      dayPnl === null || !previous || previous.value === 0
        ? null
        : (dayPnl / previous.value) * 100,
    realizedPnl: state.realizedPnl,
    unrealizedPnl,
    cagr: span > 0 && first ? cagr(first.value, totalValue, span) : null,
    volatility: annualizedVolatility(returns),
    maxDrawdown: drawdown?.maxDrawdown ?? null,
    sharpe: sharpe(returns, riskFree),
    sortino: sortino(returns, riskFree),
    beta: beta(returns, benchmarkReturns),
    alpha: alpha(returns, benchmarkReturns, riskFree),
    benchmarkReturn,
    tradeCount: state.tradeCount,
    winRate:
      state.closedTrades === 0 ? null : (state.wins / state.closedTrades) * 100,
  };
}
