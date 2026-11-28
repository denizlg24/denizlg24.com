import "server-only";
import { cached } from "../cache";
import { namesFor, resolveName } from "../entities";
import { altJson } from "../http";
import { AltBadRequest, type AltResult } from "../types";
import { usaFiscalYears, usaTransactions } from "./parse";
import {
  type ContractAction,
  type ContractsRecent,
  type ContractsTicker,
  contractsRecent,
  contractsTicker,
} from "./types";

const SOURCE = "USAspending.gov";
const BASE = "https://api.usaspending.gov/api/v2";
const CONTRACT_TYPES = ["A", "B", "C", "D"];
const FIELDS = [
  "Award ID",
  "Recipient Name",
  "Transaction Amount",
  "Action Date",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Transaction Description",
  "Award Type",
  "generated_internal_id",
];

const PREFERRED = /-P[A-Z]?$/;

const day = (date: Date) => date.toISOString().slice(0, 10);
const daysAgo = (days: number) => day(new Date(Date.now() - days * 86_400_000));

function post(path: string, body: unknown) {
  return altJson<unknown>(SOURCE, `${BASE}/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    timeoutMs: 30_000,
  });
}

function transactions(
  filters: Record<string, unknown>,
  page: number,
  limit: number,
  sort: string,
) {
  return post("search/spending_by_transaction/", {
    filters: { award_type_codes: CONTRACT_TYPES, ...filters },
    fields: FIELDS,
    sort,
    order: "desc",
    limit,
    page,
  }).then(usaTransactions);
}

const newest = (actions: ContractAction[]) =>
  actions.reduce<string | null>(
    (latest, item) => (!latest || item.date > latest ? item.date : latest),
    null,
  );

/** The current federal fiscal year starts on 1 October of the previous calendar year. */
const fiscalYear = (date = new Date()) =>
  date.getUTCMonth() >= 9 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();

export async function contractsForTicker(
  symbol: string,
  years: number,
): Promise<AltResult<ContractsTicker>> {
  const names = await namesFor(symbol);
  if (!names) throw new AltBadRequest(`${symbol} is not an SEC registrant.`);
  const searches = [names.search, ...names.aliases.slice(0, 3)];
  const windowDays = 365;
  const span = Math.min(Math.max(years, 1), 10);
  const cache = await cached({
    source: SOURCE,
    key: `ticker:${names.ticker}:${span}`,
    ttlMs: 6 * 3_600_000,
    schema: contractsTicker,
    load: async () => {
      const recipient = { recipient_search_text: searches };
      const startYear = fiscalYear() - span;
      const [raw, totals] = await Promise.all([
        transactions(
          {
            ...recipient,
            time_period: [
              { start_date: daysAgo(windowDays), end_date: day(new Date()) },
            ],
          },
          1,
          100,
          "Transaction Amount",
        ),
        post("search/spending_over_time/", {
          group: "fiscal_year",
          filters: {
            award_type_codes: CONTRACT_TYPES,
            ...recipient,
            time_period: [
              { start_date: `${startYear}-10-01`, end_date: day(new Date()) },
            ],
          },
        }),
      ]);
      const resolved = await Promise.all(
        raw.map(async (item) => ({
          ...item,
          ticker: (await resolveName(item.recipient))?.ticker ?? null,
        })),
      );
      const matched = resolved.filter(
        (item) => item.ticker === names.ticker && item.amount > 0,
      );
      matched.sort(
        (a, b) => b.date.localeCompare(a.date) || b.amount - a.amount,
      );
      return {
        ticker: names.ticker,
        names: searches,
        recipients: [...new Set(matched.map((item) => item.recipient))].slice(
          0,
          12,
        ),
        windowDays,
        fiscalYears: usaFiscalYears(totals),
        actions: matched.slice(0, 40),
        dropped: resolved.length - matched.length,
      };
    },
  });
  return {
    data: cache.value,
    source: SOURCE,
    asOf: newest(cache.value.actions),
    fetchedAt: cache.fetchedAt,
    stale: cache.stale,
  };
}

/** Largest recent contract obligations, kept only where the recipient is a listed company. */
export async function recentContracts(
  days: number,
  minAmount: number,
): Promise<AltResult<ContractsRecent>> {
  const window = Math.min(Math.max(Math.round(days), 1), 60);
  const cache = await cached({
    source: SOURCE,
    key: `recent:${window}`,
    ttlMs: 30 * 60_000,
    schema: contractsRecent,
    load: async () => {
      const filters = {
        time_period: [
          { start_date: daysAgo(window), end_date: day(new Date()) },
        ],
      };
      const pages = await Promise.all(
        [1, 2, 3].map((page) =>
          transactions(filters, page, 100, "Transaction Amount"),
        ),
      );
      const raw = pages.flat();
      const actions: ContractAction[] = [];
      for (const item of raw) {
        const hit = await resolveName(item.recipient);
        if (hit && !PREFERRED.test(hit.ticker))
          actions.push({ ...item, ticker: hit.ticker });
      }
      return { days: window, minAmount: 0, scanned: raw.length, actions };
    },
  });
  return {
    data: {
      ...cache.value,
      minAmount,
      actions: cache.value.actions.filter((item) => item.amount >= minAmount),
    },
    source: SOURCE,
    asOf: newest(cache.value.actions),
    fetchedAt: cache.fetchedAt,
    stale: cache.stale,
  };
}
