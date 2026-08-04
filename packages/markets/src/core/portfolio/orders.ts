import type {
  MarginConfig,
  MarginState,
  Order,
  Position,
  TrailBasis,
} from "../../schemas";
import { initialRequirementFor } from "./margin";

/**
 * Trigger rules for working orders. Pure: callers hand in a quote and the bar
 * covering everything since the last evaluation, and get back what should
 * happen. No store, no clock, no fills booked here.
 *
 * The bar is what makes a polled engine honest. Between two cron runs the price
 * can dive through a stop and recover, and a check against the latest quote
 * alone would never see it — the stop would sit working while the position it
 * was protecting had already been given back. Every rule therefore tests the
 * bar's range first and only falls back to the quote when no bar is available.
 *
 * Fills are priced pessimistically wherever the bar leaves the sequence
 * ambiguous: a gap through a stop fills at the gap, not at the stop, because
 * that is what actually happens to a market order sent into one.
 */

export interface OrderBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface OrderMarketContext {
  /** Latest print. Used when no bar covers the interval. */
  last: number | null;
  /** Range since the previous evaluation — typically today's daily bar. */
  bar: OrderBar | null;
  now: string;
}

export type OrderDecision =
  | { kind: "hold"; trailAnchor?: number; stopTriggeredAt?: string }
  | { kind: "fill"; price: number; quantity?: number }
  | { kind: "expire" }
  | { kind: "cancel"; reason: string };

function referencePrice(context: OrderMarketContext): number | null {
  return context.last ?? context.bar?.close ?? null;
}

function trailStop(
  anchor: number,
  basis: TrailBasis,
  value: number,
  side: Order["side"],
): number {
  // A sell trail sits below the best price seen, a buy trail above the best.
  const distance = basis === "percent" ? anchor * value : value;
  return side === "sell" ? anchor - distance : anchor + distance;
}

/** Whether a day order created on one date is still alive at `now`. */
function isExpired(order: Order, now: string): boolean {
  if (order.timeInForce === "gtc") return false;
  if (order.timeInForce === "gtd") {
    return order.expiresAt !== null && now > order.expiresAt;
  }
  return now.slice(0, 10) > order.createdAt.slice(0, 10);
}

/**
 * A limit's fill against a bar. Returns null when the bar never reached the
 * price. A gap through the limit fills at the open — better than the limit, and
 * the fill a broker would actually give.
 */
function limitFill(
  side: Order["side"],
  limit: number,
  context: OrderMarketContext,
): number | null {
  const bar = context.bar;
  if (bar) {
    if (side === "buy") {
      if (bar.open <= limit) return bar.open;
      return bar.low <= limit ? limit : null;
    }
    if (bar.open >= limit) return bar.open;
    return bar.high >= limit ? limit : null;
  }
  const price = referencePrice(context);
  if (price === null) return null;
  if (side === "buy") return price <= limit ? Math.min(price, limit) : null;
  return price >= limit ? Math.max(price, limit) : null;
}

/**
 * A stop's fill against a bar, as a market order once breached. A gap through
 * the stop fills at the open, which is the whole reason a stop is not a
 * guarantee of the stop price.
 */
function stopFill(
  side: Order["side"],
  stop: number,
  context: OrderMarketContext,
): number | null {
  const bar = context.bar;
  if (bar) {
    if (side === "buy") {
      if (bar.open >= stop) return bar.open;
      return bar.high >= stop ? stop : null;
    }
    if (bar.open <= stop) return bar.open;
    return bar.low <= stop ? stop : null;
  }
  const price = referencePrice(context);
  if (price === null) return null;
  if (side === "buy") return price >= stop ? Math.max(price, stop) : null;
  return price <= stop ? Math.min(price, stop) : null;
}

/** Whether a stop level was touched at all, ignoring where it would fill. */
function stopBreached(
  side: Order["side"],
  stop: number,
  context: OrderMarketContext,
): boolean {
  return stopFill(side, stop, context) !== null;
}

export function evaluateOrder(
  order: Order,
  context: OrderMarketContext,
): OrderDecision {
  if (order.status !== "working") return { kind: "hold" };

  const decision = triggerFor(order, context);
  // Expiry is checked after the trigger, never before: an order that filled
  // during its last session filled, and cancelling it because the evaluation
  // arrived after the close would lose a real fill to polling latency.
  if (decision.kind === "hold" && isExpired(order, context.now)) {
    return { kind: "expire" };
  }
  return decision;
}

function triggerFor(order: Order, context: OrderMarketContext): OrderDecision {
  switch (order.type) {
    case "market": {
      // Priced at the open: a market order resting in the book is sent the
      // moment the engine next looks, not at whatever the range closed at.
      const price = context.bar?.open ?? referencePrice(context);
      return price === null ? { kind: "hold" } : { kind: "fill", price };
    }

    case "limit": {
      if (order.limitPrice === null) {
        return { kind: "cancel", reason: "Limit order has no limit price" };
      }
      const fill = limitFill(order.side, order.limitPrice, context);
      return fill === null ? { kind: "hold" } : { kind: "fill", price: fill };
    }

    case "stop": {
      if (order.stopPrice === null) {
        return { kind: "cancel", reason: "Stop order has no stop price" };
      }
      const fill = stopFill(order.side, order.stopPrice, context);
      return fill === null ? { kind: "hold" } : { kind: "fill", price: fill };
    }

    case "stop_limit": {
      if (order.stopPrice === null || order.limitPrice === null) {
        return {
          kind: "cancel",
          reason: "Stop-limit order is missing a price",
        };
      }
      // Already latched by an earlier evaluation: the whole interval is fair
      // game and this is simply a limit order now.
      if (order.stopTriggeredAt !== null) {
        const fill = limitFill(order.side, order.limitPrice, context);
        return fill === null ? { kind: "hold" } : { kind: "fill", price: fill };
      }

      const armPrice = stopFill(order.side, order.stopPrice, context);
      if (armPrice === null) return { kind: "hold" };

      // Arming happens partway through the interval, so the limit can only be
      // worked against prices after it. Where the bar traded before the stop was
      // touched is not available to this order, and taking the bar's best print
      // would hand a sell stop-limit a fill at the day's high — a price it was
      // never live at.
      const marketable =
        order.side === "sell"
          ? armPrice >= order.limitPrice
          : armPrice <= order.limitPrice;
      if (marketable) return { kind: "fill", price: armPrice };

      // Gapped straight past the limit. It rests, latched, and fills only if a
      // later interval brings the price back.
      return { kind: "hold", stopTriggeredAt: context.now };
    }

    case "trailing_stop": {
      if (order.trailBasis === null || order.trailValue === null) {
        return {
          kind: "cancel",
          reason: "Trailing stop has no trail distance",
        };
      }
      const price = referencePrice(context);
      const extremeThisBar =
        order.side === "sell"
          ? (context.bar?.high ?? price)
          : (context.bar?.low ?? price);

      // The trail starts working from where it was placed. Seeding the anchor
      // and testing the stop against the same interval would let an order fill
      // on a move that happened before it existed.
      if (order.trailAnchor === null) {
        return extremeThisBar === null
          ? { kind: "hold" }
          : { kind: "hold", trailAnchor: extremeThisBar };
      }

      // Trigger against the anchor as it stood coming into the bar, before
      // ratcheting it on the same bar's extreme. A bar that made a new high and
      // then collapsed through the old stop must fill: moving the anchor first
      // would widen the stop retroactively and let the loss run.
      const stop = trailStop(
        order.trailAnchor,
        order.trailBasis,
        order.trailValue,
        order.side,
      );
      const fill = stopFill(order.side, stop, context);
      if (fill !== null) return { kind: "fill", price: fill };

      const extreme =
        order.side === "sell"
          ? Math.max(order.trailAnchor, extremeThisBar ?? order.trailAnchor)
          : Math.min(order.trailAnchor, extremeThisBar ?? order.trailAnchor);
      return extreme === order.trailAnchor
        ? { kind: "hold" }
        : { kind: "hold", trailAnchor: extreme };
    }
  }
}

/** The stop a trailing order is currently resting at, for display. */
export function trailingStopPrice(order: Order): number | null {
  if (
    order.type !== "trailing_stop" ||
    order.trailAnchor === null ||
    order.trailBasis === null ||
    order.trailValue === null
  ) {
    return null;
  }
  return trailStop(
    order.trailAnchor,
    order.trailBasis,
    order.trailValue,
    order.side,
  );
}

/**
 * How much of an order may actually execute. A reduce-only order can never take
 * a position past flat — that is what separates a stop loss from an accidental
 * short — and an order whose position is already gone has nothing left to do.
 */
export function executableQuantity(
  order: Order,
  positions: Position[],
): { quantity: number; cancelReason: string | null } {
  if (!order.reduceOnly) {
    return { quantity: order.quantity, cancelReason: null };
  }
  const held = positions.find((p) => p.ticker === order.ticker)?.quantity ?? 0;
  const closable = order.side === "sell" ? held : -held;
  if (closable <= 0) {
    return {
      quantity: 0,
      cancelReason: `No ${order.side === "sell" ? "long" : "short"} position left in ${order.ticker}`,
    };
  }
  return { quantity: Math.min(order.quantity, closable), cancelReason: null };
}

export interface AdmissionInput {
  order: Pick<Order, "ticker" | "side" | "quantity" | "reduceOnly">;
  positions: Position[];
  margin: MarginState;
  config: MarginConfig;
  allowShorts: boolean;
  /** Price the order is expected to work at, for sizing the requirement. */
  referencePrice: number;
}

/**
 * Whether an order can be accepted at all, checked when it is placed rather
 * than only when it fills. A rejection at placement is a message the owner can
 * act on; the same rejection three days later, silently, is a position that was
 * never protected.
 */
export function checkAdmissible({
  order,
  positions,
  margin,
  config,
  allowShorts,
  referencePrice,
}: AdmissionInput): string | null {
  if (referencePrice <= 0) return "No price available for this symbol";

  const held = positions.find((p) => p.ticker === order.ticker)?.quantity ?? 0;
  const signed = order.side === "buy" ? order.quantity : -order.quantity;
  const opposed = held !== 0 && Math.sign(signed) !== Math.sign(held);
  const closing = opposed ? Math.min(order.quantity, Math.abs(held)) : 0;
  const opening = order.quantity - closing;

  if (order.reduceOnly && closing <= 0) {
    return `No opposing position in ${order.ticker} to reduce`;
  }
  if (opening <= 0) return null;

  if (order.side === "sell" && held - order.quantity < 0 && !allowShorts) {
    return `Shorting is off for this portfolio; ${order.ticker} has ${held} held`;
  }

  const requirement = initialRequirementFor(
    order.side === "buy" ? "long" : "short",
    opening * referencePrice,
    config,
  );
  if (requirement > margin.buyingPower) {
    return `Needs ${requirement.toFixed(2)} against ${margin.buyingPower.toFixed(2)} buying power`;
  }
  return null;
}
