import type {
  BenchmarkPoint,
  PortfolioMetrics,
  Position,
  ValuationPoint,
} from "../../schemas";
import {
  alpha,
  annualizedVolatility,
  beta,
  maxDrawdown,
  sharpe,
  simpleReturns,
  sortino,
} from "../stats";
import type { ReplayState } from "./engine";

/**
 * A portfolio worth a fraction of a cent is liquidated, not a base to measure
 * growth against. Dividing by it turns rounding dust into a five-figure return
 * that then dominates volatility, Sharpe, Sortino and beta.
 */
const MIN_BASE_VALUE = 1e-6;

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
    if (Math.abs(previous.value) < MIN_BASE_VALUE) {
      out.push(0);
      continue;
    }
    out.push((current.value - flow - previous.value) / previous.value);
  }
  return out;
}

/**
 * Below this, a growth rate is not a growth rate. Raising a two-day return to
 * the power of 182 turns a 2% move into five figures of "CAGR" — a number that
 * is arithmetically correct, worthless, and the largest thing on the screen.
 * Now that the curve reaches today from a portfolio's first session, every new
 * portfolio would hit exactly that for its first month.
 */
const MIN_ANNUALIZATION_YEARS = 30 / 365.25;

/**
 * Annualises the same contribution-adjusted series the risk metrics use, by
 * geometrically linking the daily returns. `cagr(first.value, totalValue)`
 * would count deposits as appreciation and report growth next to a flat Sharpe.
 */
function annualizedReturn(returns: number[], years: number): number | null {
  if (returns.length === 0 || years < MIN_ANNUALIZATION_YEARS) return null;
  let growth = 1;
  for (const value of returns) {
    growth *= 1 + value;
    // A wiped-out portfolio has no real growth rate; -100% is the honest answer.
    if (growth <= 0) return -1;
  }
  return growth ** (1 / years) - 1;
}

function yearsBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Friday to Tuesday over a long weekend is the widest gap two consecutive
 * sessions can leave, so anything wider is not a day.
 */
const MAX_SESSION_GAP_DAYS = 4;

function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  );
}

/**
 * The move since the previous close, summed over what is currently held. The
 * quotes carry `prevClose` per holding, so this is defined however far back the
 * bar cache reaches — and it is the same number the positions table shows, so
 * the header cannot disagree with the rows under it.
 *
 * A lot opened today is priced from yesterday's close rather than from its own
 * fill, which overstates the day by the gap between the two. That is the
 * standard convention and the price of not needing a curve; the curve delta is
 * preferred wherever it is available precisely because it nets that out.
 */
function dayChangeFromPositions(positions: Position[]): number | null {
  const held = positions.filter((position) => position.quantity !== 0);
  // Cash earns nothing overnight here, so a book holding nothing moved by zero.
  if (held.length === 0) return 0;
  if (held.every((position) => position.dayChange === null)) return null;
  return held.reduce((sum, position) => sum + (position.dayChange ?? 0), 0);
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

  // The curve delta is the better day P&L — it nets out the day's own trades and
  // deposits — but it is only a *day* when the point before the last one is the
  // session before it. `performanceDates` builds the curve from cached bars plus
  // inception and today, so a book whose holdings have not backfilled has just
  // those two points and the "day" delta spans its entire life: Day silently
  // reported Total. Anything wider than a long weekend falls back to the
  // per-holding move against the previous close.
  const priorSession =
    last &&
    previous &&
    daysBetween(previous.date, last.date) <= MAX_SESSION_GAP_DAYS
      ? previous
      : null;

  const dayPnl =
    last && priorSession
      ? last.value -
        priorSession.value -
        (last.invested - priorSession.invested)
      : dayChangeFromPositions(positions);

  // Yesterday's equity: the curve holds it directly, and without a prior session
  // it is what the book is worth now less what it made getting there.
  const dayBase = priorSession
    ? priorSession.value
    : totalValue - (dayPnl ?? 0);

  return {
    totalValue,
    cash: last?.cash ?? state.cash,
    invested,
    totalPnl,
    totalPnlPercent: invested === 0 ? 0 : (totalPnl / invested) * 100,
    dayPnl,
    dayPnlPercent:
      dayPnl === null || dayBase === 0 ? null : (dayPnl / dayBase) * 100,
    realizedPnl: state.realizedPnl,
    unrealizedPnl,
    cagr: span > 0 ? annualizedReturn(returns, span) : null,
    volatility: annualizedVolatility(returns),
    maxDrawdown: drawdown?.maxDrawdown ?? null,
    sharpe: sharpe(returns, riskFree),
    sortino: sortino(returns, riskFree),
    beta: beta(returns, benchmarkReturns),
    alpha: alpha(returns, benchmarkReturns, riskFree),
    benchmarkReturn,
    tradeCount: state.tradeCount,
    winRate:
      state.realizingTrades === 0
        ? null
        : (state.wins / state.realizingTrades) * 100,
  };
}
