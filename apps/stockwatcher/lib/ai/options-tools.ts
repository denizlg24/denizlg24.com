import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { attempt, round, ticker } from "./shared";
import { optionsReport, type Contract, type ExpirySummary } from "@/lib/options";
import { relay } from "@/lib/relay-data";

const percent = (value: number | null) => round(value == null ? null : value * 100, 2);

const leg = (contract?: Contract) =>
  contract
    ? {
        bid: round(contract.bid, 4),
        ask: round(contract.ask, 4),
        last: round(contract.last, 4),
        iv: percent(contract.iv),
        delta: round(contract.delta, 3),
        volume: contract.volume,
        openInterest: contract.openInterest,
      }
    : null;

const summary = ({ strikes, ...item }: ExpirySummary & { T: number }) => ({
  expiry: item.expiry,
  daysToExpiry: item.daysToExpiry,
  atmIvPercent: percent(item.atmIv),
  put10OtmIvPercent: percent(item.put10Iv),
  call10OtmIvPercent: percent(item.call10Iv),
  put25DeltaIvPercent: percent(item.put25DeltaIv),
  call25DeltaIvPercent: percent(item.call25DeltaIv),
  riskReversal25Points: percent(item.riskReversal25),
  putCallRatioVolume: round(item.putCallVolume, 3),
  putCallRatioOpenInterest: round(item.putCallOpenInterest, 3),
  callVolume: item.callVolume,
  putVolume: item.putVolume,
  callOpenInterest: item.callOpenInterest,
  putOpenInterest: item.putOpenInterest,
  maxPain: item.maxPain,
  straddle: item.straddle
    ? { strike: item.straddle.strike, mid: round(item.straddle.mid, 4) }
    : null,
  impliedMovePercent: round(item.impliedMovePercent, 2),
  strikeTable: strikes.map((row) => ({
    strike: row.strike,
    call: leg(row.call),
    put: leg(row.put),
  })),
});

export function optionsTools() {
  return {
    getOptions: tool({
      description:
        "Listed options analytics for one underlying (Yahoo Finance, US-listed options mainly), computed server-side: the expiry list; per expiry ATM IV, 10%-OTM and 25-delta put/call IV (skew), put/call ratio by volume and open interest, max pain, ATM straddle and implied move %; the move implied into the next earnings date when known; and a trimmed strike table (bid/ask/last/IV/delta/volume/OI) for the first returned expiry. IV and delta are Black-Scholes (r=4%, no dividends, European approximation) from mid quotes when Yahoo's own IV is missing or inconsistent. IV and moves are in percent. Delayed data; illiquid strikes have wide spreads.",
      inputSchema: z.object({
        symbol: ticker,
        expiry: z.iso
          .date()
          .optional()
          .describe("YYYY-MM-DD; start at the first listed expiry on or after this date"),
        expiries: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .describe("How many consecutive expiries to analyze (default 3, or 1 when expiry is set)"),
        windowPercent: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe("Strike table half-width as % of spot (default 10)"),
      }),
      execute: ({ symbol, expiry, expiries, windowPercent }) =>
        attempt(async () => {
          const earnings = await relay
            .earnings(symbol)
            .then((data) => data.next?.date ?? null)
            .catch(() => null);
          const report = await optionsReport({
            symbol,
            expiry,
            count: expiries ?? (expiry ? 1 : 3),
            windowPercent: windowPercent ?? 10,
            tableRows: 15,
            earningsDate: earnings,
          });
          return {
            symbol: report.symbol,
            spot: round(report.spot, 4),
            currency: report.currency,
            expiries: report.expiries.slice(0, 40),
            analyses: report.analyses.map(summary),
            nextEarningsDate: report.nextEarningsDate,
            earningsImpliedMove: report.earnings && {
              ...report.earnings,
              straddleMovePercent: round(report.earnings.straddleMovePercent, 2),
              eventMovePercent: round(report.earnings.eventMovePercent, 2),
            },
            assumptions: "Black-Scholes, 4% risk-free rate, zero dividends; max pain uses open interest across the whole chain.",
            source: "Yahoo Finance options",
            asOf: report.asOf,
          };
        }, "Options data is unavailable."),
    }),
  };
}
