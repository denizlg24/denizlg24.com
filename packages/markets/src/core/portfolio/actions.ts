import type { CorporateAction, Trade } from "../../schemas";
import {
  applyTrade,
  CASH_TICKER,
  emptyState,
  type PriceLookup,
  sortTrades,
} from "./engine";

/**
 * Turns dividends and splits into the synthetic trades the engine replays.
 *
 * Deterministic and idempotent: ids are derived from the action, so
 * regenerating after a cache refill overwrites the previous rows instead of
 * double-paying a dividend. Callers delete non-manual trades for the ticker and
 * re-insert what this returns.
 */
export function synthesizeActionTrades(options: {
  portfolioId: string;
  ticker: string;
  actions: CorporateAction[];
  manualTrades: Trade[];
  reinvestDividends: boolean;
  allowShorts?: boolean;
  priceOn: PriceLookup;
}): Trade[] {
  const { portfolioId, ticker, actions, manualTrades, reinvestDividends } =
    options;

  const relevant = actions
    .filter((action) => action.divCash !== 0 || action.splitFactor !== 1)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (relevant.length === 0) return [];

  const manual = sortTrades(
    manualTrades.filter((trade) => trade.ticker === ticker),
  );
  const generated: Trade[] = [];
  // Replayed with the portfolio's own short policy, or the shares held on an
  // action date would be clamped at zero and a short would collect dividends
  // it in fact owes.
  const state = emptyState(0, { allowShorts: options.allowShorts });
  let cursor = 0;

  for (const action of relevant) {
    // Shares held at the close before the action takes effect.
    const cutoff = `${action.date}T00:00:00.000Z`;
    while (cursor < manual.length) {
      const trade = manual[cursor] as Trade;
      if (trade.executedAt >= cutoff) break;
      applyTrade(state, trade);
      cursor++;
    }

    const held = state.positions.get(ticker)?.quantity ?? 0;
    if (held === 0) continue;

    if (action.splitFactor !== 1) {
      const delta = held * (action.splitFactor - 1);
      if (Math.abs(delta) > 1e-9) {
        const split: Trade = {
          id: `${ticker}:${action.date}:split`,
          portfolioId,
          ticker,
          side: delta > 0 ? "buy" : "sell",
          quantity: Math.abs(delta),
          price: 0,
          fees: 0,
          executedAt: cutoff,
          source: "split",
        };
        generated.push(split);
        applyTrade(state, split);
      }
    }

    if (action.divCash > 0) {
      // A row that carries both a split and a dividend pays on the post-split
      // share count, which is what the split trade above has just applied.
      const heldAtRecord = state.positions.get(ticker)?.quantity ?? 0;
      const amount = heldAtRecord * action.divCash;
      if (amount === 0) continue;
      // A short owes the dividend to whoever lent the shares, so the same
      // action that credits a long debits a short. Booking it as a credit
      // regardless would pay the portfolio for a liability it carries.
      const owed = amount < 0;
      const credit: Trade = {
        id: `${ticker}:${action.date}:dividend`,
        portfolioId,
        ticker: CASH_TICKER,
        side: owed ? "sell" : "buy",
        quantity: Math.abs(amount),
        price: 1,
        fees: 0,
        executedAt: cutoff,
        source: "dividend",
        note: owed ? `${ticker} dividend owed on short` : `${ticker} dividend`,
      };
      generated.push(credit);
      applyTrade(state, credit);

      // There is nothing to reinvest a debit into; a short pays the dividend
      // out and the position is unchanged by it.
      if (reinvestDividends && !owed) {
        const close = options.priceOn(ticker, action.date);
        // Without a print there is nothing to reinvest at; the cash simply
        // stays in the account rather than buying shares at a guessed price.
        if (close !== null && close > 0) {
          const reinvest: Trade = {
            id: `${ticker}:${action.date}:drip`,
            portfolioId,
            ticker,
            side: "buy",
            quantity: amount / close,
            price: close,
            fees: 0,
            executedAt: `${action.date}T00:00:01.000Z`,
            source: "drip",
            note: `${ticker} dividend reinvested`,
          };
          generated.push(reinvest);
          applyTrade(state, reinvest);
        }
      }
    }
  }

  return generated;
}
