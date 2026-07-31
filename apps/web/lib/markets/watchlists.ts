import type { Watchlist } from "@repo/markets/schemas";
import { connectDB } from "@/lib/mongodb";
import { type IMarketWatchlist, MarketWatchlist } from "@/models/Market";

function toWatchlist(doc: IMarketWatchlist): Watchlist {
  return {
    id: String(doc._id),
    name: doc.name,
    tickers: doc.tickers,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listWatchlists(): Promise<Watchlist[]> {
  await connectDB();
  const docs = await MarketWatchlist.find().sort({ createdAt: 1 });
  return docs.map(toWatchlist);
}

export async function createWatchlist(input: {
  name: string;
  tickers?: string[];
}): Promise<Watchlist> {
  await connectDB();
  const doc = await MarketWatchlist.create({
    name: input.name,
    tickers: (input.tickers ?? []).map((ticker) => ticker.toUpperCase()),
  });
  return toWatchlist(doc);
}

export async function updateWatchlist(
  id: string,
  input: { name?: string; tickers?: string[] },
): Promise<Watchlist | null> {
  await connectDB();
  const doc = await MarketWatchlist.findByIdAndUpdate(
    id,
    {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.tickers === undefined
        ? {}
        : { tickers: input.tickers.map((ticker) => ticker.toUpperCase()) }),
    },
    { new: true },
  );
  return doc ? toWatchlist(doc) : null;
}

export async function deleteWatchlist(id: string): Promise<boolean> {
  await connectDB();
  return (await MarketWatchlist.findByIdAndDelete(id)) !== null;
}
