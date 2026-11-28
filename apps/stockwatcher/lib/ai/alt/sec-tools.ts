import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { execComp } from "@/lib/alt/sec/comp";
import { institutionalHolders } from "@/lib/alt/sec/holders";
import { etfHoldings } from "@/lib/alt/sec/nport";
import {
  latestHoldings,
  managerChanges,
  presentHoldings,
  resolveManagerCik,
  searchManagers,
} from "@/lib/alt/sec/thirteenf";
import { attempt, round, ticker } from "../shared";

const money = (value: number | null) =>
  value === null ? null : round(value, 0);

const managerInput = z.object({
  cik: z
    .string()
    .trim()
    .regex(/^\d{1,10}$/)
    .optional()
    .describe("The manager's SEC CIK."),
  name: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .optional()
    .describe(
      "Manager name, e.g. 'Berkshire Hathaway' or 'Bridgewater'; the best 13F filer match is used. Give cik or name.",
    ),
  limit: z.number().int().min(1).max(50).default(25),
});

const params = (input: { cik?: string; name?: string }) =>
  new URLSearchParams(
    input.cik ? { cik: input.cik } : { name: input.name ?? "" },
  );

export function secAltTools() {
  return {
    getManagerHoldings: tool({
      description:
        "An institutional investment manager's latest SEC Form 13F-HR holdings (US-listed securities, long positions only, filed up to 45 days after quarter end, so the freshest data is the last quarter). Give a manager CIK or name. Returns the report period and filing date, total reported value, and the largest positions (issuer, CUSIP, class, USD value, shares, put/call, % of the portfolio). Restatements are applied; options appear as separate put/call rows. Values are USD at quarter end, not current.",
      inputSchema: managerInput,
      execute: (input) =>
        attempt(async () => {
          const latest = await latestHoldings(
            await resolveManagerCik(params(input)),
          );
          const holdings = presentHoldings(latest);
          return {
            source: "SEC EDGAR Form 13F-HR",
            asOf: holdings.period,
            stale: latest.stale,
            manager: holdings.manager,
            filed: holdings.filed,
            restated: holdings.restated,
            positionCount: holdings.positionCount,
            totalValueUsd: money(holdings.totalValue),
            positions: holdings.positions
              .slice(0, input.limit)
              .map((position) => ({
                issuer: position.issuer,
                cusip: position.cusip,
                class: position.titleOfClass,
                putCall: position.putCall,
                valueUsd: money(position.value),
                shares: position.shares,
                shareType: position.shareType,
                portfolioPercent:
                  holdings.totalValue > 0
                    ? round((position.value / holdings.totalValue) * 100, 2)
                    : null,
              })),
          };
        }, "SEC 13F data is temporarily unavailable."),
    }),

    getManagerChanges: tool({
      description:
        "Quarter-over-quarter changes in an institutional manager's 13F holdings: the latest 13F-HR compared with the previous quarter's by CUSIP. Returns counts of new, added, reduced and sold-out positions and the largest moves by value (shares now/before, % change). Give a manager CIK or name. Positions are long US-listed securities as reported at quarter end.",
      inputSchema: managerInput,
      execute: (input) =>
        attempt(async () => {
          const result = await managerChanges(
            await resolveManagerCik(params(input)),
          );
          const { value } = result;
          return {
            source: "SEC EDGAR Form 13F-HR",
            asOf: value.current.period,
            stale: result.stale,
            manager: value.manager,
            period: value.current.period,
            previousPeriod: value.previous?.period ?? null,
            counts: value.counts,
            moves: value.changes.slice(0, input.limit).map((change) => ({
              issuer: change.issuer,
              cusip: change.cusip,
              putCall: change.putCall,
              status: change.status,
              shares: change.shares,
              previousShares: change.previousShares,
              sharesChangePercent: round(change.sharesChangePercent, 1),
              valueUsd: money(change.value),
              previousValueUsd: money(change.previousValue),
            })),
          };
        }, "SEC 13F data is temporarily unavailable."),
    }),

    searchFundManagers: tool({
      description:
        "Find institutional investment managers (SEC 13F filers) by name and get their CIK, for getManagerHoldings and getManagerChanges.",
      inputSchema: z.object({ query: z.string().trim().min(2).max(80) }),
      execute: ({ query }) =>
        attempt(async () => {
          const result = await searchManagers(query);
          return {
            source: "SEC EDGAR company search",
            asOf: null,
            stale: result.stale,
            managers: result.value.slice(0, 15),
          };
        }, "SEC manager search is temporarily unavailable."),
    }),

    getInstitutionalHolders: tool({
      description:
        "Largest institutional holders of a US-listed stock from SEC Form 13F-HR, with the change in shares versus the prior quarter. Built from the largest 13F filers' own reports (not every filer: `coverage` gives how many were checked and how many filers reported the stock in total). Shares and value are as of the report quarter end; 13F covers long positions only and lags up to 45 days.",
      inputSchema: z.object({
        symbol: ticker,
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: ({ symbol, limit }) =>
        attempt(async () => {
          const result = await institutionalHolders(symbol, limit);
          const { value } = result;
          return {
            source: "SEC EDGAR Form 13F-HR",
            asOf: value.period,
            stale: result.stale,
            symbol: value.symbol,
            company: value.name,
            cusip: value.cusip,
            coverage: value.coverage,
            checkedHoldersShares: value.totalShares,
            checkedHoldersValueUsd: money(value.totalValue),
            holders: value.holders.map((holder) => ({
              holder: holder.name,
              period: holder.period,
              shares: holder.shares,
              valueUsd: money(holder.value),
              portfolioPercent: round(holder.portfolioPercent, 2),
              sharesChange: holder.sharesChange,
              sharesChangePercent: round(holder.sharesChangePercent, 1),
              status: holder.status,
            })),
          };
        }, "SEC institutional holder data is temporarily unavailable."),
    }),

    getExecutiveCompensation: tool({
      description:
        "Executive pay for a US-listed company from its latest SEC DEF 14A proxy: the Summary Compensation Table (name, title, year, salary, bonus, stock awards, option awards, non-equity incentive, other, total, USD; best-effort HTML parse, `parsed` says whether it worked and `note` what was dropped) and, where the company's XBRL has them, pay-versus-performance figures (CEO total vs compensation actually paid, average other-NEO pay, TSR). Never estimated: missing values are null.",
      inputSchema: z.object({ symbol: ticker }),
      execute: ({ symbol }) =>
        attempt(async () => {
          const result = await execComp(symbol);
          const { value } = result;
          return {
            source: "SEC EDGAR DEF 14A",
            asOf: value.proxy?.filed ?? null,
            stale: result.stale,
            company: value.company,
            proxy: value.proxy,
            summaryTable: {
              parsed: value.summaryTable.parsed,
              note: value.summaryTable.note,
              rows: value.summaryTable.rows.slice(0, 30),
            },
            payVersusPerformance: value.payVersusPerformance.slice(0, 6),
          };
        }, "SEC executive compensation data is temporarily unavailable."),
    }),

    getEtfHoldings: tool({
      description:
        "Top holdings of an ETF or mutual fund from its latest public SEC Form N-PORT: name, CUSIP/ISIN, ticker (via OpenFIGI where it resolves), USD value, % of net assets, shares. N-PORT is published about 60 days after the period end, so `asOf` can be a quarter old. Funds that do not file N-PORT (commodity and crypto trusts) return an error.",
      inputSchema: z.object({
        symbol: ticker,
        limit: z.number().int().min(1).max(50).default(25),
      }),
      execute: ({ symbol, limit }) =>
        attempt(async () => {
          const result = await etfHoldings(symbol);
          const { value } = result;
          return {
            source: "SEC EDGAR Form N-PORT",
            asOf: value.reportDate,
            filed: value.filed,
            stale: result.stale,
            fund: value.fund,
            series: value.series,
            netAssetsUsd: money(value.netAssets),
            holdingCount: value.holdingCount,
            holdings: value.holdings.slice(0, limit).map((holding) => ({
              name: holding.name,
              ticker: holding.ticker,
              cusip: holding.cusip,
              isin: holding.isin,
              valueUsd: money(holding.value),
              percentOfNetAssets: round(holding.percentOfNetAssets, 3),
              shares: holding.shares,
              units: holding.units,
            })),
          };
        }, "SEC N-PORT data is temporarily unavailable."),
    }),
  };
}
