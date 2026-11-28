import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { pacForTicker, topPacs } from "@/lib/alt/gov/fec";
import { lobbyingFeedDoc, lobbyingForTicker } from "@/lib/alt/gov/lda";
import { fecCycle } from "@/lib/alt/gov/parse";
import type { RevolvingLobbyist } from "@/lib/alt/gov/types";
import { contractsForTicker, recentContracts } from "@/lib/alt/gov/usaspending";
import { attempt, round, ticker } from "../shared";

const provenance = (result: {
  source: string;
  asOf: string | null;
  stale: boolean;
}) => ({
  source: result.source,
  asOf: result.asOf,
  stale: result.stale,
});

const short = (value: string | null, length = 160) =>
  value && value.length > length ? `${value.slice(0, length)}…` : value;

export function govTools() {
  return {
    getGovernmentContracts: tool({
      description:
        "US federal contract obligations from USAspending.gov (contracts only, FPDS-fed, lags a few days). With a symbol: the company's largest contract actions in the last 12 months, obligations by federal fiscal year, and the recipient names matched. Without a symbol: the largest recent contract actions across the government whose recipient is a listed US company. Amounts are USD per action (modifications included, deobligations excluded).",
      inputSchema: z.object({
        symbol: ticker.optional(),
        days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .default(7)
          .describe("Feed window when no symbol."),
        minAmount: z
          .number()
          .min(0)
          .default(1_000_000)
          .describe("Feed minimum action size in USD."),
        years: z.number().int().min(1).max(10).default(5),
      }),
      execute: ({ symbol, days, minAmount, years }) =>
        attempt(async () => {
          if (symbol) {
            const result = await contractsForTicker(symbol, years);
            return {
              ...provenance(result),
              ticker: result.data.ticker,
              searchedNames: result.data.names,
              matchedRecipients: result.data.recipients,
              fiscalYears: result.data.fiscalYears,
              actions: result.data.actions.slice(0, 20).map((item) => ({
                date: item.date,
                amount: Math.round(item.amount),
                recipient: item.recipient,
                agency: item.subAgency ?? item.agency,
                description: short(item.description),
              })),
            };
          }
          const result = await recentContracts(days, minAmount);
          return {
            ...provenance(result),
            days: result.data.days,
            actions: result.data.actions.slice(0, 30).map((item) => ({
              date: item.date,
              ticker: item.ticker,
              recipient: item.recipient,
              amount: Math.round(item.amount),
              agency: item.subAgency ?? item.agency,
              description: short(item.description),
            })),
          };
        }, "Could not load government contracts."),
    }),
    getLobbying: tool({
      description:
        "Federal lobbying disclosures (Senate LDA, lda.gov). With a symbol: recent filings where the company is the client (registrant, amount, issues, agencies lobbied), spend by year and the revolving-door lobbyists. Without: the most recent filings by listed companies and the top spenders among them over the last 45 days of postings. Year totals are lower bounds when `complete` is false.",
      inputSchema: z.object({
        symbol: ticker.optional(),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: ({ symbol, limit }) =>
        attempt(async () => {
          if (symbol) {
            const result = await lobbyingForTicker(symbol);
            return {
              ...provenance(result),
              ticker: result.data.ticker,
              matchedClients: result.data.clients,
              years: result.data.years.map((row) => ({
                ...row,
                amount: round(row.amount, 0),
              })),
              complete: result.data.complete,
              filings: result.data.filings.slice(0, limit).map((item) => ({
                posted: item.posted,
                period: item.period,
                year: item.year,
                client: item.client,
                registrant: item.registrant,
                amount: item.amount,
                issues: item.issues
                  .slice(0, 4)
                  .map((issue) => issue.label ?? issue.code),
                entities: item.entities.slice(0, 6),
              })),
              revolvingDoor: result.data.revolving.slice(0, 10),
            };
          }
          const result = await lobbyingFeedDoc();
          return {
            ...provenance(result),
            windowDays: result.data.windowDays,
            topSpenders: result.data.top.slice(0, 15),
            filings: result.data.filings.slice(0, limit).map((item) => ({
              posted: item.posted,
              ticker: item.ticker,
              client: item.client,
              registrant: item.registrant,
              amount: item.amount,
              issues: item.issues
                .slice(0, 3)
                .map((issue) => issue.label ?? issue.code),
            })),
          };
        }, "Could not load lobbying filings."),
    }),
    getRevolvingDoor: tool({
      description:
        "Lobbyists who disclose a prior government position (LDA covered_position), with the clients and tickers they lobby for. With a symbol: those lobbying for that company. Without: from the latest filings by listed companies.",
      inputSchema: z.object({
        symbol: ticker.optional(),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: ({ symbol, limit }) =>
        attempt(async () => {
          const result = symbol
            ? await lobbyingForTicker(symbol)
            : await lobbyingFeedDoc();
          const revolving: RevolvingLobbyist[] = result.data.revolving;
          return {
            ...provenance(result),
            lobbyists: revolving.slice(0, limit).map((row) => ({
              name: row.name,
              formerPosition: short(row.covered, 200),
              clients: row.clients.slice(0, 5),
              registrants: row.registrants.slice(0, 3),
              filings: row.filings,
              latest: row.latest,
            })),
          };
        }, "Could not load revolving-door lobbyists."),
    }),
    getCorporatePacs: tool({
      description:
        "Corporate PAC money from the FEC. With a symbol: the company's PACs, receipts/disbursements by two-year cycle, and recent contributions to candidates and committees with the party split. Without: the corporate PACs with the largest disbursements this cycle that resolve to listed companies. Uses FEC_API_KEY (DEMO_KEY is heavily rate limited, so answers may be cached up to 24 h).",
      inputSchema: z.object({
        symbol: ticker.optional(),
        cycle: z
          .number()
          .int()
          .min(2000)
          .max(fecCycle())
          .optional()
          .describe("Even election year."),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: ({ symbol, cycle, limit }) =>
        attempt(async () => {
          if (cycle && cycle % 2)
            throw new Error("cycle must be an even year.");
          if (symbol) {
            const result = await pacForTicker(symbol, cycle);
            return {
              ...provenance(result),
              ticker: result.data.ticker,
              cycle: result.data.cycle,
              committees: result.data.committees,
              partySplit: result.data.parties.map((row) => ({
                ...row,
                amount: round(row.amount, 0),
              })),
              sampled: result.data.sampled,
              contributions: result.data.contributions
                .slice(0, limit)
                .map((item) => ({
                  date: item.date,
                  recipient: item.candidate ?? item.recipient,
                  office: item.office,
                  party: item.party,
                  amount: item.amount,
                })),
            };
          }
          const result = await topPacs(cycle);
          return {
            ...provenance(result),
            cycle: result.data.cycle,
            pacs: result.data.rows.slice(0, limit),
          };
        }, "Could not load PAC data."),
    }),
  };
}
