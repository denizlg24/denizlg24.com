import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { attempt, round, ticker } from "./shared";
import { readWorkspace, type Identity } from "@/lib/db";
import { activistStakes, insiderBuying } from "@/lib/insiders";
import { members } from "@/lib/market";
import { positionsFor } from "@/lib/portfolio";
import { universeKeys } from "@/lib/universes";

const scopeInput = {
  scope: z
    .enum(["universe", "symbols", "watchlists", "holdings", "market"])
    .default("universe")
    .describe(
      "universe = a named universe (default S&P 500); symbols = explicit list; watchlists / holdings = the user's own; market = every SEC filing in the window, which is slower and may be partial.",
    ),
  universe: z.enum(universeKeys).default("S&P 500"),
  symbols: z.array(ticker).max(500).optional(),
};

type Scope = {
  scope: "universe" | "symbols" | "watchlists" | "holdings" | "market";
  universe: (typeof universeKeys)[number];
  symbols?: string[];
};

async function resolveScope(user: Identity, input: Scope) {
  switch (input.scope) {
    case "market":
      return { label: "All SEC filers", symbols: null };
    case "universe":
      return {
        label: input.universe,
        symbols: members(input.universe).map((item) => item.symbol),
      };
    case "symbols":
      if (!input.symbols?.length)
        throw new Error("Provide symbols for scope 'symbols'.");
      return { label: "Given symbols", symbols: [...new Set(input.symbols)] };
    case "watchlists": {
      const { data } = await readWorkspace(user.id);
      const symbols = [...new Set(data.watchlists.flatMap((list) => list.symbols))];
      if (!symbols.length) throw new Error("The user has no watchlist symbols.");
      return { label: "Watchlists", symbols };
    }
    case "holdings": {
      const { data } = await readWorkspace(user.id);
      const held = new Set<string>();
      for (const book of data.books)
        for (const position of positionsFor(
          data.trades.filter((trade) => trade.bookId === book.id),
        ))
          if (position.quantity > 0) held.add(position.symbol);
      if (!held.size) throw new Error("The user has no open positions.");
      return { label: "Holdings", symbols: [...held] };
    }
  }
}

export function insiderTools({ user }: { user: Identity }) {
  return {
    getInsiderBuying: tool({
      description:
        "Screen SEC Form 4 open-market insider PURCHASES (transaction code P; not option exercises, grants or sales) over the last N days for a universe, the user's watchlists/holdings, given symbols, or the whole market, and find clusters: issuers where at least minInsiders distinct insiders bought within windowDays. Returns clusters (buyers, roles, prices, total $) and the largest individual purchases. US SEC registrants only. Runs on a ~40s budget and says so in `partial` when results are lower bounds.",
      inputSchema: z.object({
        ...scopeInput,
        days: z.number().int().min(1).max(90).default(30),
        windowDays: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(30)
          .describe("Cluster window: buyers must trade within this many days of each other."),
        minInsiders: z.number().int().min(1).max(10).default(3),
        minValue: z
          .number()
          .min(0)
          .default(0)
          .describe("Ignore individual purchases below this USD value."),
      }),
      execute: (input) =>
        attempt(async () => {
          const resolved = await resolveScope(user, input);
          const started = Date.now();
          const screen = await insiderBuying({
            symbols: resolved.symbols,
            days: input.days,
            windowDays: input.windowDays,
            minInsiders: input.minInsiders,
            minValue: input.minValue,
          });
          const money = (value: number) => round(value, 0) ?? 0;
          return {
            scope: resolved.label,
            ...screen,
            totalValue: money(screen.totalValue),
            clusters: screen.clusters.slice(0, 25).map((cluster) => ({
              ...cluster,
              totalValue: money(cluster.totalValue),
              averagePrice: round(cluster.averagePrice, 2),
              buyers: cluster.buyers.slice(0, 8).map((buyer) => ({
                ...buyer,
                shares: round(buyer.shares, 0) ?? 0,
                value: money(buyer.value),
                averagePrice: round(buyer.averagePrice, 2),
              })),
            })),
            omittedClusters: Math.max(0, screen.clusters.length - 25),
            largestPurchases: screen.largestPurchases.map((row) => ({
              ...row,
              value: money(row.value),
              price: round(row.price, 2),
              shares: round(row.shares, 0) ?? 0,
            })),
            unresolvedSymbols: screen.unresolvedSymbols.slice(0, 20),
            elapsedSeconds: round((Date.now() - started) / 1000, 1),
            currency: "USD",
            source: "SEC EDGAR Form 4",
            asOf: new Date().toISOString(),
          };
        }, "The SEC insider screen is temporarily unavailable."),
    }),
    getActivistStakes: tool({
      description:
        "New SEC Schedule 13D and 13D/A filings (activist or control-intent stakes of 5%+) in the last N days for a universe, the user's watchlists/holdings, given symbols, or the whole market; optionally Schedule 13G/13G/A passive stakes. Returns filer, subject company, % of class, shares, event and filing dates, a link, and whether it is an amendment. US SEC registrants only; ~40s budget, `partial` explains when some rows lack % of class.",
      inputSchema: z.object({
        ...scopeInput,
        days: z.number().int().min(1).max(90).default(30),
        include13G: z
          .boolean()
          .default(false)
          .describe("Also include passive Schedule 13G filings (many more rows)."),
        minPercent: z.number().min(0).max(100).default(0),
        limit: z.number().int().min(1).max(100).default(40),
      }),
      execute: (input) =>
        attempt(async () => {
          const resolved = await resolveScope(user, input);
          const started = Date.now();
          const screen = await activistStakes({
            symbols: resolved.symbols,
            days: input.days,
            include13G: input.include13G,
            minPercent: input.minPercent,
          });
          return {
            scope: resolved.label,
            ...screen,
            matched: screen.stakes.length,
            stakes: screen.stakes.slice(0, input.limit),
            unresolvedSymbols: screen.unresolvedSymbols.slice(0, 20),
            elapsedSeconds: round((Date.now() - started) / 1000, 1),
            source: "SEC EDGAR Schedule 13D/13G",
            asOf: new Date().toISOString(),
          };
        }, "The SEC activist-stake screen is temporarily unavailable."),
    }),
  };
}
