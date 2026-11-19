import type { Quote, Trade } from "./models";

export type Position = {
  symbol: string;
  currency: string;
  quantity: number;
  cost: number;
  realized: number;
};

const quantityEpsilon = 1e-8;

export function positionsFor(trades: Trade[]) {
  const positions = new Map<string, Position>();
  const ordered = trades.toSorted((a, b) => a.date.localeCompare(b.date));
  for (const trade of ordered) {
    const key = `${trade.symbol}:${trade.currency}`;
    const position = positions.get(key) ?? {
      symbol: trade.symbol,
      currency: trade.currency,
      quantity: 0,
      cost: 0,
      realized: 0,
    };
    if (trade.side === "buy") {
      position.quantity += trade.quantity;
      position.cost += trade.quantity * trade.price + trade.fees;
    } else {
      if (
        trade.quantity - position.quantity > quantityEpsilon ||
        position.quantity <= 0
      ) {
        throw new Error(
          `${trade.symbol} has too few shares in ${trade.currency} for the sale on ${trade.date}.`,
        );
      }
      const soldCost =
        position.cost * Math.min(1, trade.quantity / position.quantity);
      position.cost -= soldCost;
      position.realized += trade.quantity * trade.price - trade.fees - soldCost;
      position.quantity -= trade.quantity;
      if (position.quantity <= quantityEpsilon) {
        position.quantity = 0;
        position.cost = 0;
      }
    }
    positions.set(key, position);
  }
  return [...positions.values()];
}

export function checkTrades(trades: Trade[], books: { id: string }[]) {
  const byBook = new Map(books.map((book) => [book.id, [] as Trade[]]));
  for (const trade of trades) {
    const book = byBook.get(trade.bookId);
    if (!book)
      throw new Error("Choose a valid portfolio for each transaction.");
    book.push(trade);
  }
  for (const book of byBook.values()) positionsFor(book);
}

export function valuePosition(position: Position, quote?: Quote) {
  const price = quote?.currency === position.currency ? quote.price : null;
  const marketValue =
    position.quantity === 0
      ? 0
      : price == null
        ? null
        : position.quantity * price;
  return {
    price,
    marketValue,
    unrealized: marketValue == null ? null : marketValue - position.cost,
    dayChange:
      quote?.currency === position.currency && quote.change != null
        ? quote.change * position.quantity
        : null,
  };
}
