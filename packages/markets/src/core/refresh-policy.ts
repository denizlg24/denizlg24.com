/**
 * When background work refreshes the cache.
 *
 * The relay is unmetered, but asking Yahoo for prices nobody can trade on is
 * still waste, and a closed market polled all night is how the old quota was
 * emptied before the open. Everything here keeps refreshes inside the session.
 */

import { toDateKey } from "./candles";
import { lastSessionClose, type MarketSessionState } from "./session";

/**
 * How long after a close a daily bar is assumed to have printed.
 *
 * Providers publish end-of-day data on their own schedule, well after the bell.
 * The margin matters for more than politeness: a request for a date with no bar
 * yet still counts as a successful fetch, so coverage advances past it and that
 * session's bar is never asked for again.
 */
const DAILY_BAR_SETTLE_MS = 3 * 60 * 60 * 1000;

/**
 * The newest date a daily bar can be expected for.
 *
 * Asking beyond it costs a request, returns nothing, and silently strands the
 * pending session — which is why the cron requests through this rather than
 * through today.
 */
export function dailyBarsAvailableThrough(now: Date): string {
  const close = lastSessionClose(now);
  if (now.getTime() - close.getTime() >= DAILY_BAR_SETTLE_MS) {
    return toDateKey(close);
  }
  // One millisecond before the close lands on the session before it, whose bar
  // has certainly settled by now.
  return toDateKey(lastSessionClose(new Date(close.getTime() - 1)));
}

/**
 * How stale a cached quote may get before background work refreshes it.
 *
 * Regular hours get the live cadence. Extended hours move slowly and are rarely
 * watched, so they get a much longer one. `null` means the cron does not refresh
 * at all — see `shouldRefreshQuotes`, which still allows a first fetch.
 */
export function backgroundQuoteMaxAgeMs(
  state: MarketSessionState,
): number | null {
  switch (state) {
    case "open":
      return 120_000;
    case "pre":
    case "after":
      return 900_000;
    case "closed":
      return null;
  }
}

/**
 * Whether the cron should spend a request refreshing quotes.
 *
 * With the market closed nothing prints, so a quote taken after the last close
 * is already the final one and re-asking for it until the next open is pure
 * waste — this is the bulk of what the ungoverned cron used to spend. A closed
 * market with no such quote still gets one fetch, so a cold cache and a symbol
 * added overnight are both priced before the open rather than after it.
 */
export function shouldRefreshQuotes(options: {
  now: Date;
  state: MarketSessionState;
  /** Oldest timestamp across the requested set, ISO, or null when any is uncached. */
  oldestQuoteAt: string | null;
}): boolean {
  const { now, state, oldestQuoteAt } = options;
  if (!oldestQuoteAt) return true;

  const takenAt = Date.parse(oldestQuoteAt);
  if (!Number.isFinite(takenAt)) return true;

  const maxAge = backgroundQuoteMaxAgeMs(state);
  if (maxAge === null) return takenAt < lastSessionClose(now).getTime();
  return now.getTime() - takenAt >= maxAge;
}
