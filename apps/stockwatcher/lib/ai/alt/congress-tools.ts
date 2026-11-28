import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  amountLabel,
  type MemberProfile,
  type TickerActivity,
  type Trade,
  type TradeFeed,
} from "@/lib/alt/congress/types";
import { handlers } from "@/lib/alt/handlers/congress";
import type { AltResult } from "@/lib/alt/types";
import { attempt, round, ticker } from "../shared";

const CAUTION =
  "Disclosed amounts are ranges, not exact values. Trades are reported up to 45 days after they happen, so filing dates lag trade dates. Open-market purchases and sales only reflect what was disclosed.";

const trade = (row: Trade) => ({
  member: row.filer,
  bioguide: row.bioguide,
  party: row.party,
  state: row.state,
  chamber: row.chamber,
  owner: row.owner,
  asset: row.asset.slice(0, 90),
  ticker: row.ticker,
  assetType: row.assetType,
  side: row.side,
  tradedOn: row.transactedAt,
  filedOn: row.filedAt,
  amount: row.amountText,
  amountMin: row.amountMin,
  amountMax: row.amountMax,
  note: row.note?.slice(0, 120) ?? null,
  link: row.url,
  ocr: row.ocr || undefined,
});

const stamp = <T>(result: AltResult<T>) => ({
  source: result.source,
  asOf: result.asOf,
  fetchedAt: new Date(result.fetchedAt).toISOString(),
  stale: result.stale,
  caution: CAUTION,
});

const query = (values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value != null && value !== "") params.set(key, String(value));
  return params;
};

export function congressTools() {
  return {
    getCongressTrades: tool({
      description:
        "Latest US Congress stock trades from STOCK Act periodic transaction reports: House (House Clerk PDFs) and Senate (Senate eFD). Filter by symbol, member (bioguide id like P000197 or a name), chamber, party and buy/sell over the last N days by filing date. Amounts are disclosure ranges; filings lag trades by up to 45 days. Scanned paper filings are listed as unparsed with a link, not read. Returns at most 40 rows plus totals.",
      inputSchema: z.object({
        symbol: ticker.optional(),
        member: z.string().trim().min(2).max(60).optional(),
        chamber: z.enum(["house", "senate", "all"]).default("all"),
        party: z.enum(["Democrat", "Republican", "Independent"]).optional(),
        side: z.enum(["buy", "sell"]).optional(),
        days: z.number().int().min(1).max(730).default(90),
        limit: z.number().int().min(1).max(40).default(25),
      }),
      execute: (input) =>
        attempt(async () => {
          const result = await handlers["congress.trades"](
            query({ ...input, limit: input.limit }),
          );
          const feed: TradeFeed = result.data as TradeFeed;
          const buys = feed.trades.filter((row) => row.side === "buy").length;
          return {
            ...stamp(result),
            total: feed.total,
            shown: feed.trades.length,
            buysShown: buys,
            sellsShown: feed.trades.length - buys,
            trades: feed.trades.map(trade),
            unparsedFilings: feed.filings.slice(0, 10).map((filing) => ({
              member: filing.filer,
              chamber: filing.chamber,
              filedOn: filing.filedAt,
              reason: filing.reason,
              link: filing.url,
            })),
            filingsStillQueued: feed.pending,
            warnings: feed.warnings,
          };
        }, "Congressional trade data is temporarily unavailable."),
    }),
    getCongressMember: tool({
      description:
        "One member of Congress: party, state, chamber, recent disclosed trades, filings, and a net-worth estimate from the latest annual financial disclosure (House only; sum of asset range midpoints minus liability midpoints, so an estimate with wide error, flagged when parts could not be read). Accepts a bioguide id or a name.",
      inputSchema: z.object({
        member: z.string().trim().min(2).max(60),
        tradeLimit: z.number().int().min(1).max(40).default(20),
      }),
      execute: ({ member, tradeLimit }) =>
        attempt(async () => {
          const result = await handlers["congress.member"](query({ member }));
          const profile = result.data as MemberProfile;
          const worth = profile.netWorth;
          return {
            ...stamp(result),
            member: profile.member,
            tradeTotal: profile.tradeTotal,
            trades: profile.trades.slice(0, tradeLimit).map(trade),
            filings: profile.filings.slice(0, 10).map((filing) => ({
              kind: filing.kind,
              filedOn: filing.filedAt,
              parsed: filing.parsed,
              trades: filing.tradeCount,
              reason: filing.reason,
              link: filing.url,
            })),
            netWorthEstimate: worth && {
              reportYear: worth.year,
              filedOn: worth.filedAt,
              netWorthMidpoint: round(worth.netWorthMid, 0),
              assetsMidpoint: round(worth.assetsMid, 0),
              assetsRange: [worth.assetsLow, worth.assetsHigh],
              liabilitiesMidpoint: round(worth.liabilitiesMid, 0),
              holdingsCount: worth.holdingsCount,
              topHoldings: [...worth.holdings]
                .sort((a, b) => (b.valueMin ?? 0) - (a.valueMin ?? 0))
                .slice(0, 15)
                .map((holding) => ({
                  asset: holding.asset.slice(0, 80),
                  ticker: holding.ticker,
                  owner: holding.owner,
                  value: amountLabel(holding.valueMin, holding.valueMax),
                })),
              flags: worth.flags,
              link: worth.url,
            },
            warnings: profile.warnings,
          };
        }, "Member data is temporarily unavailable."),
    }),
    getCongressHolders: tool({
      description:
        "Which members of Congress traded or hold a given ticker: per-member trade counts, buys, sells, summed amount ranges and the latest trade date over the window, plus the member's reported holding range from their latest House annual disclosure when read. Use for 'who in Congress owns/bought X'.",
      inputSchema: z.object({
        symbol: ticker,
        days: z.number().int().min(1).max(730).default(365),
      }),
      execute: ({ symbol, days }) =>
        attempt(async () => {
          const result = await handlers["congress.holdings"](
            query({ symbol, days, limit: 30 }),
          );
          const activity = result.data as TickerActivity;
          return {
            ...stamp(result),
            ticker: activity.ticker,
            tradeTotal: activity.tradeTotal,
            members: activity.holders.slice(0, 30).map((holder) => ({
              member: holder.filer,
              bioguide: holder.bioguide,
              party: holder.party,
              state: holder.state,
              chamber: holder.chamber,
              trades: holder.trades,
              buys: holder.buys,
              sells: holder.sells,
              lastTradeOn: holder.lastTradeAt,
              amountRange: amountLabel(holder.amountLow, holder.amountHigh),
              reportedHolding: holder.holding
                ? amountLabel(holder.holding.valueMin, holder.holding.valueMax)
                : null,
            })),
            recentTrades: activity.trades.slice(0, 15).map(trade),
            warnings: activity.warnings,
          };
        }, "Congressional holdings data is temporarily unavailable."),
    }),
    getTrumpTrades: tool({
      description:
        "President Trump's periodic transaction reports (OGE Form 278-T), newest first. The filings are scanned PDFs and rows come from their OCR text layer, so asset names and some dates can be wrong and unreadable rows are skipped; tickers are matched from names and may be missing. Amounts are ranges. Each trade links to the source PDF.",
      inputSchema: z.object({
        symbol: ticker.optional(),
        side: z.enum(["buy", "sell"]).optional(),
        days: z.number().int().min(1).max(730).default(180),
        limit: z.number().int().min(1).max(40).default(25),
      }),
      execute: (input) =>
        attempt(async () => {
          const result = await handlers["trump.trades"](query(input));
          const feed = result.data as TradeFeed;
          return {
            ...stamp(result),
            total: feed.total,
            shown: feed.trades.length,
            trades: feed.trades.map(trade),
            filingsStillQueued: feed.pending,
            warnings: feed.warnings,
          };
        }, "OGE data is temporarily unavailable."),
    }),
  };
}
