import {
  accrueBorrowFees,
  checkAdmissible,
  evaluateOrder,
  executableQuantity,
  initialRequirementFor,
  type OrderBar,
  type OrderMarketContext,
  toDateKey,
} from "@repo/markets/core";
import type {
  MarginConfig,
  Order,
  OrderAmend,
  OrderInput,
  PortfolioPerformance,
  Trade,
} from "@repo/markets/schemas";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  type IMarketOrder,
  MarketOrder,
  MarketPortfolio,
  MarketTrade,
} from "@/models/Market";
import { getPerformance, marginConfigOf } from "./portfolios";
import { getQuotes, getStores } from "./service";

/**
 * The simulated matching engine. Orders are filled here and nowhere else, and
 * every fill becomes an ordinary trade in the log, so the portfolio replay stays
 * the single source of truth and a fill is indistinguishable from a typed one
 * except by its `source` and `orderId`.
 *
 * Two properties this file exists to hold:
 *
 * - **A fill is booked at most once.** The trade write and the order transition
 *   are one `findOneAndUpdate` guarded on `status: "working"`, so two overlapping
 *   cron runs cannot both fill the same order.
 * - **Nothing fills without a price the engine can defend.** No quote and no bar
 *   means the order holds, never a guessed fill.
 */

function toOrder(doc: IMarketOrder): Order {
  return {
    id: String(doc._id),
    portfolioId: String(doc.portfolioId),
    ticker: doc.ticker,
    side: doc.side,
    type: doc.type as Order["type"],
    quantity: doc.quantity,
    limitPrice: doc.limitPrice,
    stopPrice: doc.stopPrice,
    trailBasis: doc.trailBasis as Order["trailBasis"],
    trailValue: doc.trailValue,
    trailAnchor: doc.trailAnchor,
    stopTriggeredAt: doc.stopTriggeredAt
      ? doc.stopTriggeredAt.toISOString()
      : null,
    timeInForce: doc.timeInForce as Order["timeInForce"],
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
    reduceOnly: doc.reduceOnly,
    status: doc.status as Order["status"],
    parentOrderId: doc.parentOrderId ? String(doc.parentOrderId) : null,
    ocoGroupId: doc.ocoGroupId,
    filledQuantity: doc.filledQuantity,
    filledPrice: doc.filledPrice,
    filledAt: doc.filledAt ? doc.filledAt.toISOString() : null,
    tradeId: doc.tradeId ? String(doc.tradeId) : null,
    statusReason: doc.statusReason,
    fees: doc.fees,
    note: doc.note ?? undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listOrders(
  portfolioId: string,
  status?: Order["status"][],
): Promise<Order[]> {
  await connectDB();
  const docs = await MarketOrder.find({
    portfolioId,
    ...(status?.length ? { status: { $in: status } } : {}),
  }).sort({ createdAt: -1 });
  return docs.map(toOrder);
}

export async function getOrder(
  portfolioId: string,
  orderId: string,
): Promise<Order | null> {
  await connectDB();
  const doc = await MarketOrder.findOne({ _id: orderId, portfolioId });
  return doc ? toOrder(doc) : null;
}

/** Last traded price the engine can size and admit an order against. */
async function referencePriceFor(ticker: string): Promise<number | null> {
  const stores = getStores();
  const { quotes } = await getQuotes([ticker]).catch(async () => ({
    quotes: await stores.quotes.getQuotes([ticker]),
  }));
  const last = quotes.find((quote) => quote.ticker === ticker)?.last;
  if (last != null) return last;
  const bars = await stores.bars.getDailyBars(ticker);
  return bars.at(-1)?.close ?? null;
}

export class OrderRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderRejected";
  }
}

/**
 * Buying power the book has already promised to orders that have not filled.
 *
 * `performance.margin` describes the portfolio as it stands, which counts a
 * working order for nothing at all. Admitting against that alone lets N orders
 * each fit the same buying power, and the engine then fills every one of them —
 * the account ends up leveraged well past its own initial requirement without a
 * single check having failed.
 *
 * Reduce-only orders are left out: they free exposure rather than commit it.
 */
async function committedRequirement(
  portfolioId: string,
  config: MarginConfig,
): Promise<number> {
  const open = await MarketOrder.find({
    portfolioId,
    status: { $in: ["working", "pending"] },
    reduceOnly: false,
  });
  if (open.length === 0) return 0;

  const stores = getStores();
  const cached = await stores.quotes.getQuotes([
    ...new Set(open.map((doc) => doc.ticker)),
  ]);
  const lastByTicker = new Map(
    cached.map((quote) => [quote.ticker, quote.last]),
  );

  let total = 0;
  for (const doc of open) {
    // The level the order works at is the best estimate of what it will cost.
    // A market order has none and prices off the last print instead.
    const price =
      doc.limitPrice ?? doc.stopPrice ?? lastByTicker.get(doc.ticker) ?? null;
    if (price === null) continue;
    total += initialRequirementFor(
      doc.side === "buy" ? "long" : "short",
      doc.quantity * price,
      config,
    );
  }
  return total;
}

/**
 * Places an order and, when one is attached, its bracket. The exits are created
 * `pending` and share an OCO group: they arm together when the entry fills and
 * cancel each other when either one does.
 */
export async function placeOrder(
  portfolioId: string,
  input: OrderInput,
): Promise<Order[]> {
  await connectDB();
  const portfolio = await MarketPortfolio.findById(portfolioId);
  if (!portfolio) throw new OrderRejected("Portfolio not found");

  const performance = await getPerformance(portfolioId);
  if (!performance) throw new OrderRejected("Portfolio not found");

  const reference = await referencePriceFor(input.ticker);
  if (reference === null) {
    throw new OrderRejected(`No price available for ${input.ticker}`);
  }

  // Checked at placement rather than only at fill. The same rejection arriving
  // silently three days later is a position that was never protected.
  const config = marginConfigOf(portfolio);
  const committed = await committedRequirement(portfolioId, config);
  const problem = checkAdmissible({
    order: input,
    positions: performance.positions,
    margin: {
      ...performance.margin,
      buyingPower: Math.max(0, performance.margin.buyingPower - committed),
    },
    config,
    allowShorts: portfolio.allowShorts ?? false,
    referencePrice: reference,
  });
  if (problem) throw new OrderRejected(problem);

  const owner = new Types.ObjectId(portfolioId);
  const entry = await MarketOrder.create({
    portfolioId: owner,
    ticker: input.ticker,
    side: input.side,
    type: input.type,
    quantity: input.quantity,
    limitPrice: input.limitPrice,
    stopPrice: input.stopPrice,
    trailBasis: input.trailBasis,
    trailValue: input.trailValue,
    timeInForce: input.timeInForce,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    reduceOnly: input.reduceOnly,
    fees: input.fees,
    note: input.note,
    // An entry carrying a bracket is parked until every leg exists. There is no
    // transaction here, so an entry created live could fill against a bracket
    // that is still half-written and leave the position protected on one side
    // only — with nothing downstream that would ever notice.
    status: input.bracket ? "pending" : "working",
  });

  if (!input.bracket) return [toOrder(entry)];

  const exitSide = input.side === "buy" ? "sell" : "buy";
  const group = String(entry._id);
  const legs: Record<string, unknown>[] = [];

  if (input.bracket.takeProfitPrice !== null) {
    legs.push({
      type: "limit",
      limitPrice: input.bracket.takeProfitPrice,
      note: "Take profit",
    });
  }
  if (input.bracket.stopLossTrailValue !== null) {
    legs.push({
      type: "trailing_stop",
      trailBasis: input.bracket.stopLossTrailBasis ?? "percent",
      trailValue: input.bracket.stopLossTrailValue,
      note: "Trailing stop",
    });
  } else if (input.bracket.stopLossPrice !== null) {
    legs.push({
      type: "stop",
      stopPrice: input.bracket.stopLossPrice,
      note: "Stop loss",
    });
  }

  const exits: Order[] = [];
  try {
    for (const leg of legs) {
      const doc = await MarketOrder.create({
        portfolioId: owner,
        ticker: input.ticker,
        side: exitSide,
        quantity: input.quantity,
        timeInForce: "gtc",
        // An exit can only ever close what the entry opened. Without this a
        // bracket on a filled-and-manually-closed position would flip the book
        // to the other side rather than doing nothing.
        reduceOnly: true,
        status: "pending",
        parentOrderId: entry._id,
        ocoGroupId: group,
        ...leg,
      });
      exits.push(toOrder(doc));
    }
  } catch (error) {
    // Nothing here was ever exposed to the market — the entry is still parked
    // and the legs cannot arm without it — so the half-written bracket is
    // removed rather than left in the book as an order that can never fill.
    await MarketOrder.deleteMany({
      $or: [{ _id: entry._id }, { parentOrderId: entry._id }],
    });
    throw error;
  }

  const armed = await MarketOrder.findOneAndUpdate(
    { _id: entry._id, status: "pending" },
    { $set: { status: "working" } },
    { returnDocument: "after" },
  );
  return [toOrder(armed ?? entry), ...exits];
}

export async function amendOrder(
  portfolioId: string,
  orderId: string,
  amend: OrderAmend,
): Promise<Order | null> {
  await connectDB();
  const update: Record<string, unknown> = { ...amend };
  if (amend.expiresAt !== undefined) {
    update.expiresAt = amend.expiresAt ? new Date(amend.expiresAt) : null;
  }
  // A trail whose distance changed must re-anchor, or the stop would jump to a
  // level derived from a distance the owner has just replaced.
  if (amend.trailValue !== undefined) update.trailAnchor = null;

  const doc = await MarketOrder.findOneAndUpdate(
    { _id: orderId, portfolioId, status: { $in: ["working", "pending"] } },
    { $set: update },
    { returnDocument: "after" },
  );
  return doc ? toOrder(doc) : null;
}

export async function cancelOrder(
  portfolioId: string,
  orderId: string,
  reason = "Cancelled",
): Promise<Order | null> {
  await connectDB();
  const doc = await MarketOrder.findOneAndUpdate(
    { _id: orderId, portfolioId, status: { $in: ["working", "pending"] } },
    { $set: { status: "cancelled", statusReason: reason } },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  // A cancelled entry leaves its bracket unreachable; those legs can never arm.
  await MarketOrder.updateMany(
    { portfolioId, parentOrderId: doc._id, status: "pending" },
    { $set: { status: "cancelled", statusReason: "Entry cancelled" } },
  );
  return toOrder(doc);
}

export interface OrderEngineResult {
  evaluated: number;
  filled: number;
  cancelled: number;
  expired: number;
  /** Borrow booked this pass, in cash rather than in rows. */
  borrowCharged: number;
  marginCalls: string[];
  errors: string[];
}

/**
 * The range the order has actually been exposed to: every completed session
 * since the day it was placed. Daily bars are the backstop that makes a polled
 * engine safe — a stop breached and recovered between two runs shows in the
 * range and nowhere else.
 *
 * The placement day itself is excluded, and this is the whole subtlety. A daily
 * bar carries no time of day, so a stop entered at 3pm would otherwise fill on
 * that morning's low — a move that happened before the order existed. Today is
 * covered by the live quote instead, and the bar takes over once the session it
 * belongs to is behind the order.
 */
async function barSincePlacement(
  ticker: string,
  createdAt: Date,
): Promise<OrderBar | null> {
  const stores = getStores();
  const placedOn = toDateKey(createdAt);
  const bars = (await stores.bars.getDailyBars(ticker, placedOn)).filter(
    (bar) => bar.date > placedOn,
  );
  if (bars.length === 0) return null;

  // Collapsed into one range rather than replayed bar by bar. The engine only
  // needs to know whether a level was touched while the order was live, and the
  // extremes of the span answer that for every order type.
  const first = bars[0] as (typeof bars)[number];
  const last = bars.at(-1) as (typeof bars)[number];
  return {
    open: first.open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: last.close,
  };
}

/**
 * Books a fill and closes out the order.
 *
 * The order is claimed first, by a `findOneAndUpdate` guarded on
 * `status: "working"`. That guard is what makes concurrent cron runs safe — the
 * second one matches nothing and books nothing — and it has to come first, since
 * writing the trade first would let two runs both book a fill before either
 * claimed the order.
 *
 * There is no transaction to lean on, so the claim is undone by hand if the
 * trade write then fails. A filled order with no trade behind it is the worse
 * failure of the two: it reads as a closed position that the replay never saw,
 * and nothing would ever retry it.
 *
 * The trade's id is allocated before the claim so the link is part of the claim
 * rather than a write after it. Setting `tradeId` afterwards leaves a window
 * where the trade exists and the order points at nothing — a link nothing
 * retries and nothing detects, since the replay reads trades and still balances.
 */
async function bookFill(
  order: Order,
  price: number,
  quantity: number,
  now: Date,
): Promise<boolean> {
  const tradeId = new Types.ObjectId();
  const claimed = await MarketOrder.findOneAndUpdate(
    { _id: order.id, status: "working" },
    {
      $set: {
        status: "filled",
        filledPrice: price,
        filledQuantity: quantity,
        filledAt: now,
        tradeId,
      },
    },
    { returnDocument: "after" },
  );
  if (!claimed) return false;

  try {
    await MarketTrade.create({
      _id: tradeId,
      portfolioId: new Types.ObjectId(order.portfolioId),
      ticker: order.ticker,
      side: order.side,
      quantity,
      price,
      fees: order.fees,
      executedAt: now,
      source: "order",
      note: order.note,
      orderId: claimed._id,
    });
  } catch (error) {
    await MarketOrder.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: "working",
          filledPrice: null,
          filledQuantity: 0,
          filledAt: null,
          tradeId: null,
        },
      },
    );
    throw error;
  }

  // A bracket's entry filling is what arms its exits. This and the OCO
  // cancellation below are repeated by `reconcileBrackets` on the next pass, so
  // a process that stops between the claim and here does not leave a position
  // permanently unprotected.
  await MarketOrder.updateMany(
    { parentOrderId: claimed._id, status: "pending" },
    { $set: { status: "working" } },
  );
  // One leg of an OCO filling cancels the other, which is the whole contract.
  if (order.ocoGroupId) {
    await MarketOrder.updateMany(
      {
        ocoGroupId: order.ocoGroupId,
        _id: { $ne: claimed._id },
        status: { $in: ["working", "pending"] },
      },
      { $set: { status: "cancelled", statusReason: "Other leg filled" } },
    );
  }
  return true;
}

/**
 * Re-applies the two writes that follow a fill: arming a bracket's exits, and
 * cancelling the sibling of an OCO leg that filled. Both are idempotent, and
 * both happen after the claim in `bookFill`, so a process that stops in between
 * would otherwise leave exits parked forever behind an entry that already
 * filled. Two queries against the live book is a cheap way to close that.
 */
async function reconcileBrackets(portfolioId: string): Promise<void> {
  const parked = await MarketOrder.find({
    portfolioId,
    status: "pending",
    parentOrderId: { $ne: null },
  });
  if (parked.length > 0) {
    const parents = await MarketOrder.find(
      {
        _id: { $in: parked.map((doc) => doc.parentOrderId) },
        status: "filled",
      },
      { _id: 1 },
    );
    const filled = new Set(parents.map((doc) => String(doc._id)));
    const arm = parked
      .filter((doc) => filled.has(String(doc.parentOrderId)))
      .map((doc) => doc._id);
    if (arm.length > 0) {
      await MarketOrder.updateMany(
        { _id: { $in: arm } },
        { $set: { status: "working" } },
      );
    }
  }

  const live = await MarketOrder.find(
    {
      portfolioId,
      status: { $in: ["working", "pending"] },
      ocoGroupId: { $ne: null },
    },
    { ocoGroupId: 1 },
  );
  if (live.length === 0) return;
  const settled = await MarketOrder.find(
    {
      portfolioId,
      ocoGroupId: { $in: [...new Set(live.map((doc) => doc.ocoGroupId))] },
      status: "filled",
    },
    { ocoGroupId: 1 },
  );
  if (settled.length === 0) return;
  await MarketOrder.updateMany(
    {
      portfolioId,
      ocoGroupId: { $in: [...new Set(settled.map((doc) => doc.ocoGroupId))] },
      status: { $in: ["working", "pending"] },
    },
    { $set: { status: "cancelled", statusReason: "Other leg filled" } },
  );
}

/**
 * Evaluates every working order in a portfolio, books the fills, then accrues
 * the day's borrow and reports any margin call.
 *
 * Order matters. Fills settle first because they change the book the margin is
 * then measured against — charging borrow on a short an order has just covered
 * would bill for a position that no longer exists.
 */
export async function runOrderEngine(
  portfolioId: string,
  now = new Date(),
): Promise<OrderEngineResult> {
  await connectDB();
  const result: OrderEngineResult = {
    evaluated: 0,
    filled: 0,
    cancelled: 0,
    expired: 0,
    borrowCharged: 0,
    marginCalls: [],
    errors: [],
  };

  const portfolio = await MarketPortfolio.findById(portfolioId);
  if (!portfolio) return result;

  await reconcileBrackets(portfolioId);

  const working = await MarketOrder.find({ portfolioId, status: "working" });
  let performance: PortfolioPerformance | null = null;

  if (working.length > 0) {
    const opening = await getPerformance(portfolioId);
    // Sizing a reduce-only order against an empty position list reads as "no
    // position left", and that cancels the order. Absorbing a null here would
    // turn one transient failure into every stop loss and take profit in the
    // portfolio being cancelled at once, and a cancel cannot be undone.
    if (!opening) {
      result.errors.push("No performance available; no orders evaluated");
      return result;
    }
    let book = opening;
    const stores = getStores();
    const nowIso = now.toISOString();

    for (const [index, doc] of working.entries()) {
      const order = toOrder(doc);
      result.evaluated++;
      try {
        const [quotes, bar] = await Promise.all([
          stores.quotes.getQuotes([order.ticker]),
          barSincePlacement(order.ticker, doc.createdAt),
        ]);
        const context: OrderMarketContext = {
          // Matched by symbol rather than taken from index 0: the store is free
          // to answer with a cached superset or a reordered batch, and pricing
          // a fill off another symbol writes a wrong price into a trade that
          // the replay then accepts as fact.
          last:
            quotes.find((quote) => quote.ticker === order.ticker)?.last ?? null,
          bar,
          now: nowIso,
        };

        const decision = evaluateOrder(order, context);
        if (decision.kind === "hold") {
          const patch: Record<string, unknown> = {};
          if (decision.trailAnchor !== undefined) {
            patch.trailAnchor = decision.trailAnchor;
          }
          if (decision.stopTriggeredAt !== undefined) {
            patch.stopTriggeredAt = new Date(decision.stopTriggeredAt);
          }
          if (Object.keys(patch).length > 0) {
            await MarketOrder.updateOne({ _id: doc._id }, { $set: patch });
          }
          continue;
        }

        if (decision.kind === "expire") {
          await MarketOrder.updateOne(
            { _id: doc._id, status: "working" },
            { $set: { status: "expired", statusReason: "Time in force" } },
          );
          result.expired++;
          continue;
        }

        if (decision.kind === "cancel") {
          await cancelOrder(portfolioId, order.id, decision.reason);
          result.cancelled++;
          continue;
        }

        const sizing = executableQuantity(order, book.positions);
        if (sizing.cancelReason) {
          await cancelOrder(portfolioId, order.id, sizing.cancelReason);
          result.cancelled++;
          continue;
        }

        if (await bookFill(order, decision.price, sizing.quantity, now)) {
          result.filled++;
          // The book moved, so every later order in this pass must be sized
          // against the new positions rather than the stale snapshot — but only
          // a reduce-only order reads positions at all, and `getPerformance`
          // replays the entire trade log. Refetching after every fill regardless
          // makes the pass cost O(fills × trades) for a number nothing uses.
          const resizes = working
            .slice(index + 1)
            .some((later) => later.reduceOnly);
          if (resizes) {
            const refreshed = await getPerformance(portfolioId);
            if (!refreshed) {
              result.errors.push("No performance available; pass stopped");
              return result;
            }
            book = refreshed;
          }
        }
      } catch (error) {
        result.errors.push(`${order.ticker}: ${String(error)}`);
      }
    }
    // Borrow is measured against the book the fills left behind, or a short an
    // order has just covered would still be billed for the day. That costs one
    // replay for the pass rather than one per fill.
    performance = result.filled > 0 ? await getPerformance(portfolioId) : book;
  }

  const margin = marginConfigOf(portfolio);
  const today = toDateKey(now);
  if (margin.enabled) {
    performance ??= await getPerformance(portfolioId);
    if (performance) {
      const accrual = await chargeBorrow(
        portfolioId,
        performance,
        portfolio.borrowAccruedThrough ?? null,
        today,
        margin,
      );
      result.borrowCharged = accrual.charged;
      // Advanced when there was nothing to bill as well as when something was
      // billed. Leaving the marker behind on a flat book would hand the next
      // short the previous one's uncharged days and bill it for carry it never
      // ran. A short whose daily carry rounds to nothing is the one case the
      // marker deliberately stays put: those days accumulate until they are
      // worth a cent, rather than being forgiven one run at a time.
      if (accrual.charged > 0 || accrual.accruable === 0) {
        await MarketPortfolio.updateOne(
          { _id: portfolio._id },
          { $set: { borrowAccruedThrough: today } },
        );
      }
      // Reported, never acted on. An engine that liquidated on its own would
      // turn a data glitch — one stale quote on one holding — into a sold book.
      if (performance.margin.marginCall) {
        result.marginCalls.push(
          `${portfolio.name}: ${performance.margin.marginCallAmount.toFixed(2)} short`,
        );
      }
    }
  }

  return result;
}

/**
 * Books the day's carry and reports it in money, plus how many positions could
 * have produced a charge at all — which is what tells the caller whether an
 * empty result means "nothing owed" or "owed, but not yet a cent".
 */
async function chargeBorrow(
  portfolioId: string,
  performance: PortfolioPerformance,
  since: string | null,
  date: string,
  config: ReturnType<typeof marginConfigOf>,
): Promise<{ charged: number; accruable: number }> {
  const accruable =
    config.borrowRate > 0
      ? performance.positions.filter((position) => position.quantity < 0).length
      : 0;
  const fees: Trade[] = accrueBorrowFees({
    portfolioId,
    positions: performance.positions,
    config,
    date,
    since,
  });
  if (fees.length === 0) return { charged: 0, accruable };

  const owner = new Types.ObjectId(portfolioId);
  // Upserted on the deterministic id. Charging borrow twice for a day is the
  // failure that matters, and the unique index on `actionKey` is what stops it
  // even if two runs overlap.
  await MarketTrade.bulkWrite(
    fees.map((fee) => ({
      updateOne: {
        filter: { portfolioId: owner, actionKey: fee.id },
        update: {
          $set: {
            portfolioId: owner,
            ticker: fee.ticker,
            side: fee.side,
            quantity: fee.quantity,
            price: fee.price,
            fees: 0,
            executedAt: new Date(fee.executedAt),
            source: fee.source,
            note: fee.note ?? "",
            actionKey: fee.id,
          },
        },
        upsert: true,
      },
    })),
  );
  return {
    charged: fees.reduce((sum, fee) => sum + fee.price * fee.quantity, 0),
    accruable,
  };
}
