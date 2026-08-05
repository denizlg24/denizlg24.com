import { z } from "zod";
import {
  isoDateTimeSchema,
  priceSchema,
  quantitySchema,
  tickerSchema,
} from "./common";
import { tradeSideSchema } from "./portfolio";

/**
 * Working orders the engine fills by itself. Fills are simulated against cached
 * quotes and daily bars — there is no broker on the other end — but the
 * lifecycle, the trigger rules and the vocabulary are the ones a trading
 * platform uses, so a book built here reads the same as one built at a broker.
 */

export const orderTypeSchema = z.enum([
  "market",
  "limit",
  "stop",
  "stop_limit",
  "trailing_stop",
]);
export type OrderType = z.infer<typeof orderTypeSchema>;

export const timeInForceSchema = z.enum(["day", "gtc", "gtd"]);
export type TimeInForce = z.infer<typeof timeInForceSchema>;

/**
 * `pending` is a bracket child waiting on its parent: it is not yet exposed to
 * the market and cannot fill or expire. Everything else is terminal except
 * `working`.
 */
export const orderStatusSchema = z.enum([
  "pending",
  "working",
  "filled",
  "cancelled",
  "expired",
  "rejected",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const trailBasisSchema = z.enum(["amount", "percent"]);
export type TrailBasis = z.infer<typeof trailBasisSchema>;

export const orderSchema = z.object({
  id: z.string(),
  portfolioId: z.string(),
  ticker: tickerSchema,
  side: tradeSideSchema,
  type: orderTypeSchema,
  quantity: quantitySchema.positive(),
  /** Worst price accepted. Required for `limit` and `stop_limit`. */
  limitPrice: priceSchema.positive().nullable().default(null),
  /** Price that arms the order. Required for `stop` and `stop_limit`. */
  stopPrice: priceSchema.positive().nullable().default(null),
  trailBasis: trailBasisSchema.nullable().default(null),
  /** Currency distance when `trailBasis` is amount, fraction when percent. */
  trailValue: z.number().positive().nullable().default(null),
  /**
   * Best price seen since the trailing stop started working. The stop is always
   * `trailValue` away from this, and it only ever moves in the position's
   * favour — that ratchet is the whole point of the order type.
   */
  trailAnchor: priceSchema.positive().nullable().default(null),
  /**
   * When a stop-limit's stop was breached. Once set the order is a plain limit
   * and stays one: a stop that armed and then saw the price recover does not
   * disarm at a broker, and re-requiring the breach here would let a stop-limit
   * miss the very rebound its limit was placed to catch.
   */
  stopTriggeredAt: isoDateTimeSchema.nullable().default(null),
  timeInForce: timeInForceSchema.default("gtc"),
  /** Required for `gtd`; the order expires at the first evaluation past it. */
  expiresAt: isoDateTimeSchema.nullable().default(null),
  /**
   * Never opens or flips a position — the fill is clamped to what is held, and
   * the order is cancelled if the position is already gone. What makes a stop
   * loss a stop loss rather than a way to accidentally go short.
   */
  reduceOnly: z.boolean().default(false),
  status: orderStatusSchema.default("working"),
  /** Set on a bracket child; it arms when the parent fills. */
  parentOrderId: z.string().nullable().default(null),
  /** Members cancel each other on fill. A bracket's two exits share one. */
  ocoGroupId: z.string().nullable().default(null),
  filledQuantity: quantitySchema.nonnegative().default(0),
  filledPrice: priceSchema.nonnegative().nullable().default(null),
  filledAt: isoDateTimeSchema.nullable().default(null),
  /** Trade the fill booked, so the blotter can link the two. */
  tradeId: z.string().nullable().default(null),
  /** Why a `rejected`, `cancelled` or `expired` order ended where it did. */
  statusReason: z.string().max(200).nullable().default(null),
  fees: z.number().nonnegative().default(0),
  note: z.string().max(500).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Order = z.infer<typeof orderSchema>;

/** A take-profit and a stop-loss to attach to an entry, as an OCO pair. */
export const bracketInputSchema = z.object({
  takeProfitPrice: priceSchema.positive().nullable().default(null),
  stopLossPrice: priceSchema.positive().nullable().default(null),
  /** Turns the stop-loss leg into a trailing stop at this distance. */
  stopLossTrailBasis: trailBasisSchema.nullable().default(null),
  stopLossTrailValue: z.number().positive().nullable().default(null),
});
export type BracketInput = z.infer<typeof bracketInputSchema>;

const orderInputBase = orderSchema
  .pick({
    ticker: true,
    side: true,
    type: true,
    quantity: true,
    limitPrice: true,
    stopPrice: true,
    trailBasis: true,
    trailValue: true,
    timeInForce: true,
    expiresAt: true,
    reduceOnly: true,
    fees: true,
    note: true,
  })
  .extend({ bracket: bracketInputSchema.nullable().default(null) });

/**
 * Enforced here rather than in the route so every caller — API, cron, a future
 * agent tool — gets the same rules. Each type needs exactly the prices it acts
 * on; accepting a stop without a `stopPrice` would create an order that can
 * never trigger and would sit in the book looking armed.
 */
export const orderInputSchema = orderInputBase.superRefine((order, ctx) => {
  const needsLimit = order.type === "limit" || order.type === "stop_limit";
  const needsStop = order.type === "stop" || order.type === "stop_limit";

  if (needsLimit && order.limitPrice === null) {
    ctx.addIssue({
      code: "custom",
      path: ["limitPrice"],
      message: `A ${order.type} order needs a limit price`,
    });
  }
  if (needsStop && order.stopPrice === null) {
    ctx.addIssue({
      code: "custom",
      path: ["stopPrice"],
      message: `A ${order.type} order needs a stop price`,
    });
  }
  if (order.type === "trailing_stop") {
    if (order.trailBasis === null || order.trailValue === null) {
      ctx.addIssue({
        code: "custom",
        path: ["trailValue"],
        message: "A trailing stop needs a trail distance",
      });
    }
    if (order.trailBasis === "percent" && (order.trailValue ?? 0) >= 1) {
      ctx.addIssue({
        code: "custom",
        path: ["trailValue"],
        message: "A percent trail is a fraction, e.g. 0.05 for 5%",
      });
    }
  }
  if (order.timeInForce === "gtd" && order.expiresAt === null) {
    ctx.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "A good-till-date order needs an expiry",
    });
  }
  // A reduce-only order closes exposure and opens none, so exits attached to
  // it would arm against a position its own fill has just removed and cancel
  // themselves on the next pass. Brackets belong on orders that open something.
  if (order.bracket && order.reduceOnly) {
    ctx.addIssue({
      code: "custom",
      path: ["bracket"],
      message: "A reduce-only order cannot carry a bracket",
    });
  }
});
export type OrderInput = z.infer<typeof orderInputSchema>;

/**
 * Price and size are amendable while working; side, type and symbol are not.
 *
 * A price can be moved but never removed. Type is not amendable, so clearing
 * the level a working order acts on — a limit's `limitPrice`, a stop's
 * `stopPrice`, a trail's distance — leaves an order the engine can only cancel,
 * and it would be cancelled silently on the next pass rather than rejected here
 * where the owner can see it.
 */
export const orderAmendSchema = z.object({
  quantity: quantitySchema.positive().optional(),
  limitPrice: priceSchema.positive().optional(),
  stopPrice: priceSchema.positive().optional(),
  trailValue: z.number().positive().optional(),
  timeInForce: timeInForceSchema.optional(),
  expiresAt: isoDateTimeSchema.nullable().optional(),
  note: z.string().max(500).optional(),
});
export type OrderAmend = z.infer<typeof orderAmendSchema>;
