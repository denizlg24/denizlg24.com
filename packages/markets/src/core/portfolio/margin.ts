import type { MarginConfig, MarginState, Position, Trade } from "../../schemas";
import { CASH_TICKER } from "./engine";

/**
 * Reg-T style margin, computed fresh from cash and open positions on every read.
 * Nothing here is stored: a margin state that lagged the book by even one quote
 * would be worse than none, because it would clear a call that is still live.
 *
 * Two things are deliberately not modelled. There is no intraday versus
 * overnight distinction — a single requirement applies at all times. And a house
 * call is never auto-liquidated by this module; it reports the shortfall and the
 * order engine decides, so a call cannot silently sell the book.
 */

/** Equity below this is noise, not a base to divide leverage by. */
const MIN_EQUITY = 1e-6;

export interface MarginInputs {
  cash: number;
  positions: Position[];
  config: MarginConfig;
}

export function computeMargin({
  cash,
  positions,
  config,
}: MarginInputs): MarginState {
  let longExposure = 0;
  let shortExposure = 0;
  let initialMargin = 0;
  let maintenanceMargin = 0;

  for (const position of positions) {
    if (position.quantity === 0) continue;
    // `buildPositions` reports a market value of zero when nothing could price
    // the holding. Carrying that straight through would drop the position out
    // of the requirement entirely — an unpriced short would lift excess
    // liquidity and clear a call while the borrowed shares are still out. The
    // cost basis is the last defensible number for it.
    const exposure =
      position.lastPrice === null
        ? Math.abs(position.costBasis)
        : Math.abs(position.marketValue);
    if (position.quantity > 0) {
      longExposure += exposure;
      initialMargin += exposure * config.initialLong;
      maintenanceMargin += exposure * config.maintenanceLong;
      continue;
    }
    shortExposure += exposure;
    initialMargin += exposure * config.initialShort;
    maintenanceMargin += exposure * config.maintenanceShort;
  }

  // Short proceeds are already sitting in `cash`, and the short's own negative
  // market value cancels them. Equity is therefore just cash plus signed value
  // on both sides, with no separate collateral term.
  const equity = cash + longExposure - shortExposure;
  const grossExposure = longExposure + shortExposure;
  const excessLiquidity = equity - maintenanceMargin;

  // Without margin the account can only ever commit the cash it holds, and a
  // requirement expressed as a fraction of exposure would otherwise let it
  // commit twice that.
  const buyingPower = config.enabled
    ? Math.max(0, equity - initialMargin)
    : Math.max(0, cash);

  return {
    equity,
    cash,
    longExposure,
    shortExposure,
    grossExposure,
    netExposure: longExposure - shortExposure,
    initialMargin,
    maintenanceMargin,
    excessLiquidity,
    buyingPower,
    leverage: equity > MIN_EQUITY ? grossExposure / equity : null,
    marginCall: excessLiquidity < 0,
    marginCallAmount: excessLiquidity < 0 ? -excessLiquidity : 0,
  };
}

/**
 * What opening `exposure` more of a side would cost against buying power. A
 * trade that closes exposure frees margin rather than consuming it, so callers
 * must pass only the opening portion.
 */
export function initialRequirementFor(
  side: "long" | "short",
  exposure: number,
  config: MarginConfig,
): number {
  if (!config.enabled) return exposure;
  return (
    exposure * (side === "long" ? config.initialLong : config.initialShort)
  );
}

/**
 * Days between two ISO dates, floored at zero. Borrow accrues on calendar days
 * rather than trading days — the loan does not pause for a weekend.
 */
function daysBetween(from: string, to: string): number {
  const ms =
    Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  // A stored `borrowAccruedThrough` that is not a date key parses to NaN, and
  // NaN passes every `<= 0` guard below it. The charge would then be booked as
  // a NaN cash debit that the replay adds to `state.cash`, and every curve
  // point, metric and margin state for the portfolio is NaN from then on with
  // nothing to recompute it. Treat it as "charge nothing" instead.
  if (!Number.isFinite(ms)) return 0;
  return ms <= 0 ? 0 : Math.round(ms / 86_400_000);
}

export interface BorrowAccrualInput {
  portfolioId: string;
  positions: Position[];
  config: MarginConfig;
  /** Day the charge is booked for, `YYYY-MM-DD`. */
  date: string;
  /** Last date already charged, so a gap of days is caught up in one go. */
  since: string | null;
}

/**
 * One cash debit per short position per accrual, priced off the position's
 * current market value at `config.borrowRate` a year on a 360-day basis.
 *
 * Ids are deterministic — `borrow:<ticker>:<date>` — so a rerun of the same day
 * upserts in place. Charging borrow twice for a day is the failure mode that
 * matters here, and it is the store's unique `actionKey` plus this id that
 * prevent it, not any check on the caller's side.
 */
export function accrueBorrowFees({
  portfolioId,
  positions,
  config,
  date,
  since,
}: BorrowAccrualInput): Trade[] {
  if (!config.enabled || config.borrowRate <= 0) return [];
  // A first accrual charges the day itself; afterwards it charges every day the
  // cron did not run, so an outage does not silently forgive the carry.
  const days = since === null ? 1 : daysBetween(since, date);
  if (days <= 0) return [];

  const trades: Trade[] = [];
  for (const position of positions) {
    if (position.quantity >= 0) continue;
    const exposure = Math.abs(position.marketValue);
    if (exposure <= 0) continue;
    const amount = (exposure * config.borrowRate * days) / 360;
    // Sub-cent carry rounds to nothing and would otherwise litter the log with
    // zero-value rows on every run.
    if (amount < 0.005) continue;
    trades.push({
      id: `borrow:${position.ticker}:${date}`,
      portfolioId,
      ticker: CASH_TICKER,
      side: "sell",
      quantity: amount,
      price: 1,
      fees: 0,
      executedAt: `${date}T23:59:00.000Z`,
      source: "borrow",
      note: `${position.ticker} borrow, ${days}d`,
    });
  }
  return trades;
}
