import type {
  ContributionPoint,
  ContributionSeries,
  Portfolio,
  Position,
  Trade,
  ValuationPoint,
} from "../../schemas";

/**
 * Rebuilds portfolio state by replaying the trade log. Nothing here reads a
 * store — callers hand in trades and prices, which keeps the maths testable and
 * lets both the API and a future standalone build share it.
 *
 * Three conventions the rest of the module depends on:
 *
 * - **Average cost, not FIFO.** Realised PnL on a sale is `(price - avgCost) *
 *   quantity - fees`. FIFO would need lot tracking for a tax story this app
 *   does not tell.
 * - **Prices are raw, never split-adjusted.** Splits arrive as explicit trades,
 *   so pairing them with adjusted closes would count the same split twice.
 * - **Cash movements are trades too**, against the reserved `CASH` ticker, so
 *   the log stays the single source of truth.
 */

export const CASH_TICKER = "CASH";

export interface PositionState {
  quantity: number;
  costBasis: number;
  realizedPnl: number;
}

export interface ReplayState {
  cash: number;
  /** Net external contributions: initial cash plus deposits less withdrawals. */
  invested: number;
  positions: Map<string, PositionState>;
  realizedPnl: number;
  tradeCount: number;
  wins: number;
  closedTrades: number;
}

export function emptyState(initialCash: number): ReplayState {
  return {
    cash: initialCash,
    invested: initialCash,
    positions: new Map(),
    realizedPnl: 0,
    tradeCount: 0,
    wins: 0,
    closedTrades: 0,
  };
}

function positionFor(state: ReplayState, ticker: string): PositionState {
  const existing = state.positions.get(ticker);
  if (existing) return existing;
  const created: PositionState = {
    quantity: 0,
    costBasis: 0,
    realizedPnl: 0,
  };
  state.positions.set(ticker, created);
  return created;
}

export function applyTrade(state: ReplayState, trade: Trade): void {
  if (trade.source === "deposit" || trade.source === "withdrawal") {
    const amount = trade.quantity * trade.price;
    const signed = trade.source === "deposit" ? amount : -amount;
    state.cash += signed;
    state.invested += signed;
    return;
  }

  // A dividend paid in cash credits the account without counting as money the
  // owner put in. A reinvesting portfolio also emits the follow-up buy, so the
  // cash nets back out on its own.
  if (trade.ticker === CASH_TICKER) {
    const amount = trade.quantity * trade.price;
    state.cash += trade.side === "buy" ? amount : -amount;
    return;
  }

  const position = positionFor(state, trade.ticker);

  // A split changes the share count against an unchanged cost basis; it moves
  // no cash and realises nothing.
  if (trade.source === "split") {
    const delta = trade.side === "buy" ? trade.quantity : -trade.quantity;
    position.quantity += delta;
    if (position.quantity <= 0) {
      position.quantity = 0;
      position.costBasis = 0;
    }
    return;
  }

  state.tradeCount++;

  if (trade.side === "buy") {
    position.quantity += trade.quantity;
    position.costBasis += trade.quantity * trade.price;
    state.cash -= trade.quantity * trade.price + trade.fees;
    return;
  }

  const sold = Math.min(trade.quantity, position.quantity);
  const avgCost =
    position.quantity > 0 ? position.costBasis / position.quantity : 0;
  const realized = (trade.price - avgCost) * sold - trade.fees;

  position.quantity -= sold;
  position.costBasis -= avgCost * sold;
  position.realizedPnl += realized;
  state.realizedPnl += realized;
  state.cash += trade.quantity * trade.price - trade.fees;

  if (position.quantity <= 1e-9) {
    position.quantity = 0;
    position.costBasis = 0;
  }

  state.closedTrades++;
  if (realized > 0) state.wins++;
}

export function replayTrades(
  trades: Trade[],
  initialCash: number,
  until?: string,
): ReplayState {
  const state = emptyState(initialCash);
  for (const trade of sortTrades(trades)) {
    if (until && trade.executedAt > until) break;
    applyTrade(state, trade);
  }
  return state;
}

/**
 * Stable ordering matters: two trades stamped the same instant must replay the
 * same way on every call, or a sale can be evaluated against a cost basis that
 * depends on Mongo's return order.
 */
export function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    if (a.executedAt !== b.executedAt) {
      return a.executedAt < b.executedAt ? -1 : 1;
    }
    const rank = sourceRank(a) - sourceRank(b);
    if (rank !== 0) return rank;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Corporate actions settle before discretionary trades on the same stamp, so a
// sale on split day is measured against the post-split share count.
function sourceRank(trade: Trade): number {
  if (trade.source === "split") return 0;
  if (trade.source === "dividend") return 1;
  return 2;
}

export interface PriceLookup {
  /** Raw close for a ticker on a date, or null when the market was shut. */
  (ticker: string, date: string): number | null;
}

export function buildPositions(
  state: ReplayState,
  priceAt: (ticker: string) => number | null,
  previousCloseAt: (ticker: string) => number | null,
): Position[] {
  const positions: Position[] = [];
  let totalValue = state.cash;

  for (const [ticker, held] of state.positions) {
    if (held.quantity === 0 && held.realizedPnl === 0) continue;
    const lastPrice = priceAt(ticker);
    const marketValue = lastPrice === null ? 0 : lastPrice * held.quantity;
    totalValue += marketValue;
  }

  for (const [ticker, held] of state.positions) {
    if (held.quantity === 0 && held.realizedPnl === 0) continue;
    const lastPrice = priceAt(ticker);
    const previousClose = previousCloseAt(ticker);
    const marketValue = lastPrice === null ? 0 : lastPrice * held.quantity;
    const avgCost = held.quantity > 0 ? held.costBasis / held.quantity : 0;
    const unrealizedPnl = lastPrice === null ? 0 : marketValue - held.costBasis;
    const dayChange =
      lastPrice === null || previousClose === null
        ? null
        : (lastPrice - previousClose) * held.quantity;

    positions.push({
      ticker,
      quantity: held.quantity,
      avgCost,
      costBasis: held.costBasis,
      lastPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent:
        held.costBasis === 0 ? 0 : (unrealizedPnl / held.costBasis) * 100,
      realizedPnl: held.realizedPnl,
      dayChange,
      dayChangePercent:
        dayChange === null || previousClose === null || previousClose === 0
          ? null
          : ((lastPrice as number) / previousClose - 1) * 100,
      weight: totalValue === 0 ? 0 : marketValue / totalValue,
    });
  }

  return positions.sort((a, b) => b.marketValue - a.marketValue);
}

/**
 * Walks the trade log forward one date at a time so each point costs a single
 * pass. Dates must be ascending and are typically the union of trading days
 * between inception and today.
 */
export function buildValuationCurve(
  portfolio: Pick<Portfolio, "initialCash">,
  trades: Trade[],
  dates: string[],
  priceOn: PriceLookup,
): ValuationPoint[] {
  const ordered = sortTrades(trades);
  const state = emptyState(portfolio.initialCash);
  const lastKnownPrice = new Map<string, number>();
  const curve: ValuationPoint[] = [];
  let cursor = 0;

  for (const date of dates) {
    // Trades stamped any time on this date have settled by its close.
    const dayEnd = `${date}T23:59:59.999Z`;
    while (cursor < ordered.length) {
      const trade = ordered[cursor] as Trade;
      if (trade.executedAt > dayEnd) break;
      applyTrade(state, trade);
      cursor++;
    }

    let positionsValue = 0;
    for (const [ticker, held] of state.positions) {
      if (held.quantity === 0) continue;
      const close = priceOn(ticker, date);
      // A halted or untraded symbol holds its last close rather than
      // vanishing from the curve and faking a drawdown.
      const price = close ?? lastKnownPrice.get(ticker) ?? null;
      if (close !== null) lastKnownPrice.set(ticker, close);
      if (price === null) continue;
      positionsValue += price * held.quantity;
    }

    const value = state.cash + positionsValue;
    const totalPnl = value - state.invested;
    curve.push({
      date,
      value,
      cash: state.cash,
      positionsValue,
      invested: state.invested,
      totalPnl,
      totalPnlPercent:
        state.invested === 0 ? 0 : (totalPnl / state.invested) * 100,
    });
  }

  return curve;
}

/**
 * Splits the equity curve into one series per symbol, so a flat portfolio that
 * is actually one winner cancelling one loser reads as exactly that.
 *
 * A symbol's series begins on its first trade rather than at inception, and
 * continues after a full exit — its realised PnL still belongs to the total, so
 * dropping the line would leak the contribution out of the attribution.
 */
export function buildContributionSeries(
  portfolio: Pick<Portfolio, "initialCash">,
  trades: Trade[],
  dates: string[],
  priceOn: PriceLookup,
): ContributionSeries[] {
  const ordered = sortTrades(trades);
  const state = emptyState(portfolio.initialCash);
  const lastKnownPrice = new Map<string, number>();
  // Gross cost of every purchase ever made in a symbol. Unlike `costBasis` this
  // does not fall back to zero on a full exit, which is what keeps the percent
  // return of a closed position from dividing by nothing.
  const grossCost = new Map<string, number>();
  const points = new Map<string, ContributionPoint[]>();
  let cursor = 0;

  for (const date of dates) {
    const dayEnd = `${date}T23:59:59.999Z`;
    while (cursor < ordered.length) {
      const trade = ordered[cursor] as Trade;
      if (trade.executedAt > dayEnd) break;
      if (
        trade.side === "buy" &&
        trade.ticker !== CASH_TICKER &&
        trade.source !== "split"
      ) {
        grossCost.set(
          trade.ticker,
          (grossCost.get(trade.ticker) ?? 0) +
            trade.quantity * trade.price +
            trade.fees,
        );
      }
      applyTrade(state, trade);
      cursor++;
    }

    for (const [ticker, held] of state.positions) {
      if (ticker === CASH_TICKER) continue;

      const close = priceOn(ticker, date);
      const price = close ?? lastKnownPrice.get(ticker) ?? null;
      if (close !== null) lastKnownPrice.set(ticker, close);

      const marketValue = price === null ? 0 : price * held.quantity;
      // An unpriced symbol contributes nothing unrealised rather than a
      // fabricated loss against its cost basis.
      const unrealized = price === null ? 0 : marketValue - held.costBasis;
      const pnl = held.realizedPnl + unrealized;
      const basis = grossCost.get(ticker) ?? 0;

      let series = points.get(ticker);
      if (!series) {
        series = [];
        points.set(ticker, series);
      }
      series.push({
        date,
        marketValue,
        pnl,
        returnPercent: basis === 0 ? 0 : (pnl / basis) * 100,
      });
    }
  }

  // Biggest movers first so the legend leads with what actually explains the
  // curve, regardless of which direction it moved.
  return [...points]
    .map(([ticker, series]) => ({ ticker, points: series }))
    .sort(
      (a, b) =>
        Math.abs(b.points.at(-1)?.pnl ?? 0) -
        Math.abs(a.points.at(-1)?.pnl ?? 0),
    );
}
