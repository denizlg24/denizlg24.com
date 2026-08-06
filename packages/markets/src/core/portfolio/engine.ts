import type {
  ContributionPoint,
  ContributionSeries,
  MarginConfig,
  Portfolio,
  Position,
  Trade,
  ValuationPoint,
} from "../../schemas";
import { DEFAULT_MARGIN } from "../../schemas";

/**
 * Rebuilds portfolio state by replaying the trade log. Nothing here reads a
 * store — callers hand in trades and prices, which keeps the maths testable and
 * lets both the API and a future standalone build share it.
 *
 * Four conventions the rest of the module depends on:
 *
 * - **Average cost, not FIFO.** Realised PnL on a close is `(price - avgCost) *
 *   quantity` in the position's own direction, less fees. FIFO would need lot
 *   tracking for a tax story this app does not tell.
 * - **Positions are signed.** A short is a negative quantity carrying a negative
 *   cost basis, so `costBasis === avgCost * quantity` holds on both sides and
 *   `marketValue - costBasis` is the unrealised PnL of either. One formula, no
 *   branch, which is what keeps the curve and the metrics side-agnostic.
 * - **Prices are raw, never split-adjusted.** Splits arrive as explicit trades,
 *   so pairing them with adjusted closes would count the same split twice.
 * - **Cash movements are trades too**, against the reserved `CASH` ticker, so
 *   the log stays the single source of truth.
 */

export const CASH_TICKER = "CASH";

export interface PositionState {
  /** Negative while short. */
  quantity: number;
  /** Signed, and always `avgCost * quantity`. */
  costBasis: number;
  realizedPnl: number;
}

/** Quantities below this are floating-point residue, not a held position. */
const QUANTITY_EPSILON = 1e-9;

export interface ReplayState {
  cash: number;
  /** Net external contributions: initial cash plus deposits less withdrawals. */
  invested: number;
  positions: Map<string, PositionState>;
  realizedPnl: number;
  tradeCount: number;
  wins: number;
  /**
   * Sales that realised PnL, including partial ones. `winRate` is therefore a
   * per-sale figure, not a per-closed-position figure.
   */
  realizingTrades: number;
  /**
   * Off by default. A sell into a flat or long-exhausted book is then clamped to
   * what is held rather than opening a short, which is the right default for a
   * cash account and preserves the pre-shorts behaviour exactly.
   */
  allowShorts: boolean;
}

export interface ReplayOptions {
  allowShorts?: boolean;
}

export function emptyState(
  initialCash: number,
  options: ReplayOptions = {},
): ReplayState {
  return {
    cash: initialCash,
    invested: initialCash,
    positions: new Map(),
    realizedPnl: 0,
    tradeCount: 0,
    wins: 0,
    realizingTrades: 0,
    allowShorts: options.allowShorts ?? false,
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

/**
 * How a trade lands against what is already held: the part that closes existing
 * exposure and the part that opens new exposure in the trade's own direction. A
 * trade that crosses through zero does both, which is how a sell larger than the
 * long flips the position short in one fill.
 */
export function splitAgainstPosition(
  held: number,
  signedQuantity: number,
): { closing: number; opening: number } {
  const size = Math.abs(signedQuantity);
  const opposed = held !== 0 && Math.sign(signedQuantity) !== Math.sign(held);
  const closing = opposed ? Math.min(size, Math.abs(held)) : 0;
  return { closing, opening: size - closing };
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
  // owner put in — and is a debit when the position is short, since the borrower
  // owes it. A reinvesting portfolio also emits the follow-up buy, so the cash
  // nets back out on its own. Borrow fees ride the same path.
  if (trade.ticker === CASH_TICKER) {
    const amount = trade.quantity * trade.price;
    state.cash += trade.side === "buy" ? amount : -amount;
    return;
  }

  // A split changes the share count against an unchanged cost basis; it moves
  // no cash and realises nothing. A short splits too, in its own direction.
  if (trade.source === "split") {
    const split = positionFor(state, trade.ticker);
    const delta = trade.side === "buy" ? trade.quantity : -trade.quantity;
    split.quantity += delta;
    if (Math.abs(split.quantity) <= QUANTITY_EPSILON) {
      split.quantity = 0;
      split.costBasis = 0;
    }
    return;
  }

  const existing = state.positions.get(trade.ticker);
  const requested = trade.side === "buy" ? trade.quantity : -trade.quantity;
  const held = existing?.quantity ?? 0;
  const { closing, opening } = splitAgainstPosition(held, requested);

  // Without shorts enabled, the part of a sale that would open short exposure
  // settles nothing — whether the book was flat or the sale simply ran past the
  // long. Crediting cash for it would fabricate money the portfolio never had,
  // and the inflated balance would propagate into every curve point and metric.
  const allowedOpening = requested > 0 || state.allowShorts ? opening : 0;
  const opened = trade.side === "buy" ? allowedOpening : -allowedOpening;
  const executed = closing + allowedOpening;
  // A sale a cash account cannot make settles nothing at all — not a row in the
  // book, not a tick on the trade count.
  if (executed <= 0) return;

  state.tradeCount++;

  const position = existing ?? positionFor(state, trade.ticker);
  const avgCost = held !== 0 ? position.costBasis / held : 0;

  if (closing > 0) {
    // A long makes money above its cost, a short below it. `direction` is the
    // only place the two sides differ.
    const direction = held > 0 ? 1 : -1;
    const realized = (trade.price - avgCost) * closing * direction - trade.fees;
    position.quantity -= closing * Math.sign(held);
    position.costBasis -= avgCost * closing * Math.sign(held);
    position.realizedPnl += realized;
    state.realizedPnl += realized;
    state.realizingTrades++;
    if (realized > 0) state.wins++;
  }

  if (allowedOpening > 0) {
    position.quantity += opened;
    position.costBasis += trade.price * opened;
  }

  // Proceeds of a short sale are credited exactly like those of a closing sale;
  // in a margin account they sit as collateral rather than as spendable cash,
  // which is what the margin engine's buying power accounts for.
  state.cash +=
    trade.side === "buy"
      ? -(executed * trade.price) - trade.fees
      : executed * trade.price - trade.fees;

  if (Math.abs(position.quantity) <= QUANTITY_EPSILON) {
    position.quantity = 0;
    position.costBasis = 0;
  }
}

export function replayTrades(
  trades: Trade[],
  initialCash: number,
  until?: string,
  options: ReplayOptions = {},
): ReplayState {
  const state = emptyState(initialCash, options);
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
  if (trade.source === "borrow") return 1;
  return 2;
}

/** Raw close for a ticker on a date, or null when the market was shut. */
export type PriceLookup = (ticker: string, date: string) => number | null;

/**
 * The dates an equity curve is evaluated on: every session the cache knows
 * about, plus the two endpoints that make the curve mean anything.
 *
 * Driving this from cached bars alone is wrong in both directions. A daily bar
 * for today does not exist until after the close, so the curve stopped at the
 * previous session while positions were already priced live — and a portfolio
 * opened today had no bars at all, so it had no curve whatsoever and reported
 * only its uninvested cash. Inception supplies a first point; today supplies a
 * last one, priced by the caller from live quotes.
 *
 * Both endpoints are clamped to the portfolio's own lifetime: a bar from before
 * inception would value a book that did not exist, and one dated after today
 * would put the curve in the future.
 */
export function performanceDates(options: {
  barDates: Iterable<string>;
  inceptionDate: string;
  today: string;
}): string[] {
  const { barDates, inceptionDate, today } = options;
  const dates = new Set<string>(barDates);
  dates.add(inceptionDate);
  // A portfolio dated in the future has not started; giving it a point at today
  // would open its curve before its own inception.
  if (today >= inceptionDate) dates.add(today);
  return [...dates]
    .filter((date) => date >= inceptionDate && date <= today)
    .sort();
}

export function buildPositions(
  state: ReplayState,
  priceAt: (ticker: string) => number | null,
  previousCloseAt: (ticker: string) => number | null,
  margin: MarginConfig = DEFAULT_MARGIN,
): Position[] {
  const positions: Position[] = [];
  const priced: {
    ticker: string;
    held: PositionState;
    lastPrice: number | null;
    marketValue: number;
  }[] = [];
  let grossExposure = 0;

  for (const [ticker, held] of state.positions) {
    if (held.quantity === 0 && held.realizedPnl === 0) continue;
    const lastPrice = priceAt(ticker);
    const marketValue = lastPrice === null ? 0 : lastPrice * held.quantity;
    priced.push({ ticker, held, lastPrice, marketValue });
    grossExposure += Math.abs(marketValue);
  }

  for (const { ticker, held, lastPrice, marketValue } of priced) {
    const previousClose = previousCloseAt(ticker);
    const avgCost = held.quantity !== 0 ? held.costBasis / held.quantity : 0;
    const unrealizedPnl = lastPrice === null ? 0 : marketValue - held.costBasis;
    const dayChange =
      lastPrice === null || previousClose === null
        ? null
        : (lastPrice - previousClose) * held.quantity;
    const exposure = Math.abs(marketValue);
    const short = held.quantity < 0;

    positions.push({
      ticker,
      quantity: held.quantity,
      side: short ? "short" : "long",
      avgCost,
      costBasis: held.costBasis,
      lastPrice,
      marketValue,
      exposure,
      unrealizedPnl,
      // Against the capital the position ties up, which for a short is the
      // absolute basis — dividing by a negative basis would report a profitable
      // cover as a loss.
      unrealizedPnlPercent:
        held.costBasis === 0
          ? 0
          : (unrealizedPnl / Math.abs(held.costBasis)) * 100,
      realizedPnl: held.realizedPnl,
      dayChange,
      // A short gains when the price falls, so the position's day percentage is
      // the print's move inverted, not the print's move.
      dayChangePercent:
        dayChange === null || previousClose === null || previousClose === 0
          ? null
          : ((lastPrice as number) / previousClose - 1) *
            100 *
            (short ? -1 : 1),
      weight: grossExposure === 0 ? 0 : exposure / grossExposure,
      // Falls back to the basis when nothing could price the holding, matching
      // `computeMargin`. A position that carries no requirement because it
      // could not be priced is the one way a call gets cleared while the risk
      // is still on.
      maintenanceMargin:
        (lastPrice === null ? Math.abs(held.costBasis) : exposure) *
        (short ? margin.maintenanceShort : margin.maintenanceLong),
      // The price at which everything done in this symbol nets to zero, not
      // merely the open lot: partial profit-taking moves it, which is the
      // number that actually tells you where you can walk away flat.
      breakEven:
        held.quantity === 0 ? null : avgCost - held.realizedPnl / held.quantity,
    });
  }

  return positions.sort((a, b) => b.exposure - a.exposure);
}

/**
 * Walks the trade log forward one date at a time so each point costs a single
 * pass. Dates must be ascending and are typically the union of trading days
 * between inception and today.
 */
export function buildValuationCurve(
  portfolio: Pick<Portfolio, "initialCash"> & { allowShorts?: boolean },
  trades: Trade[],
  dates: string[],
  priceOn: PriceLookup,
): ValuationPoint[] {
  const ordered = sortTrades(trades);
  const state = emptyState(portfolio.initialCash, {
    allowShorts: portfolio.allowShorts,
  });
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
      // Before a symbol's first cached bar there is no last close to hold, and
      // forward fill has nothing to fill from. Dropping the position valued it
      // at zero, so a book that had spent its cash on a date with no bars —
      // inception on a weekend, or a holding whose bars start later — produced
      // a point worth nothing, and the next point's move read as the whole
      // portfolio appearing out of thin air. That is the bogus day P&L. A
      // position nothing has priced is carried at cost, which is signed exactly
      // like `price * quantity` and so works for a short unchanged.
      positionsValue += price === null ? held.costBasis : price * held.quantity;
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
  portfolio: Pick<Portfolio, "initialCash"> & { allowShorts?: boolean },
  trades: Trade[],
  dates: string[],
  priceOn: PriceLookup,
): ContributionSeries[] {
  const ordered = sortTrades(trades);
  const state = emptyState(portfolio.initialCash, {
    allowShorts: portfolio.allowShorts,
  });
  const lastKnownPrice = new Map<string, number>();
  // Gross notional of every position ever opened in a symbol, long or short.
  // Unlike `costBasis` this does not fall back to zero on a full exit, which is
  // what keeps the percent return of a closed position from dividing by
  // nothing; counting openings rather than buys is what makes a short — whose
  // opening trade is a sale — measure against the capital it actually risked.
  const grossCost = new Map<string, number>();
  const points = new Map<string, ContributionPoint[]>();
  let cursor = 0;

  for (const date of dates) {
    const dayEnd = `${date}T23:59:59.999Z`;
    while (cursor < ordered.length) {
      const trade = ordered[cursor] as Trade;
      if (trade.executedAt > dayEnd) break;
      if (trade.ticker !== CASH_TICKER && trade.source !== "split") {
        const held = state.positions.get(trade.ticker)?.quantity ?? 0;
        const requested =
          trade.side === "buy" ? trade.quantity : -trade.quantity;
        const { opening } = splitAgainstPosition(held, requested);
        // The same clamp `applyTrade` applies. Without shorts enabled a sale
        // that runs past the long settles nothing, so counting its notional
        // here would divide every later `returnPercent` for the symbol by
        // capital the book never committed.
        const allowedOpening = requested > 0 || state.allowShorts ? opening : 0;
        if (allowedOpening > 0) {
          grossCost.set(
            trade.ticker,
            (grossCost.get(trade.ticker) ?? 0) +
              allowedOpening * trade.price +
              trade.fees,
          );
        }
      }
      applyTrade(state, trade);
      cursor++;
    }

    for (const [ticker, held] of state.positions) {
      if (ticker === CASH_TICKER) continue;

      const close = priceOn(ticker, date);
      const price = close ?? lastKnownPrice.get(ticker) ?? null;
      if (close !== null) lastKnownPrice.set(ticker, close);

      // Carried at cost while unpriced, matching `buildValuationCurve` so the
      // attribution lines still sum to the curve's `positionsValue`.
      const marketValue =
        price === null ? held.costBasis : price * held.quantity;
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
