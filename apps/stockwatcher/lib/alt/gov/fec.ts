import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { namesFor, resolveName } from "../entities";
import { altJson } from "../http";
import { AltBadRequest, type AltResult } from "../types";
import {
  fecCommittees,
  fecContributions,
  fecCycle,
  fecTotals,
  groupCycles,
  pacOrgCandidates,
  partySplit,
} from "./parse";
import { type PacTicker, type PacTop, pacTicker, pacTop } from "./types";

const SOURCE = "FEC (api.open.fec.gov)";
const BASE = "https://api.open.fec.gov/v1";
const DAY = 24 * 3_600_000;

const apiKey = () => process.env.FEC_API_KEY?.trim() || "DEMO_KEY";

async function fec(path: string, params: [string, string | number][]) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("api_key", apiKey());
  for (const [name, value] of params)
    url.searchParams.append(name, String(value));
  return altJson<unknown>(SOURCE, url.toString(), { timeoutMs: 30_000 });
}

/** The company a PAC belongs to: its connected organisation, else its own name. */
async function companyOf(names: (string | null)[]) {
  for (const name of names) {
    if (!name) continue;
    for (const candidate of pacOrgCandidates(name)) {
      const hit = await resolveName(candidate);
      if (hit) return hit;
    }
  }
  return null;
}

const latestCoverage = (dates: (string | null)[]) =>
  dates.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);

export async function pacForTicker(
  symbol: string,
  cycle = fecCycle(),
): Promise<AltResult<PacTicker>> {
  const names = await namesFor(symbol);
  if (!names) throw new AltBadRequest(`${symbol} is not an SEC registrant.`);
  const cache = await cached({
    source: SOURCE,
    key: `ticker:${names.ticker}:${cycle}`,
    ttlMs: DAY,
    schema: pacTicker,
    load: async () => {
      const searches = [names.search, ...names.aliases.slice(0, 1)];
      const found = new Map<
        string,
        {
          id: string;
          name: string;
          organization: string | null;
          lastFiled: string | null;
        }
      >();
      for (const search of searches) {
        const list = fecCommittees(
          await fec("committees/", [
            ["q", search],
            ["organization_type", "C"],
            ["per_page", 30],
            ["sort", "-last_file_date"],
          ]),
        );
        for (const row of list) {
          if (found.has(row.id)) continue;
          const hit = await companyOf([row.affiliated, row.name]);
          if (hit?.ticker === names.ticker)
            found.set(row.id, {
              id: row.id,
              name: row.name,
              organization: row.affiliated,
              lastFiled: row.lastFiled,
            });
        }
      }
      const committees = [...found.values()]
        .sort((a, b) => (b.lastFiled ?? "").localeCompare(a.lastFiled ?? ""))
        .slice(0, 4);
      const empty = {
        ticker: names.ticker,
        names: searches,
        cycle,
        committees: [],
        contributions: [],
        parties: [],
        sampled: false,
      };
      if (!committees.length) return empty;
      const ids = committees.map((row): [string, string] => [
        "committee_id",
        row.id,
      ]);
      const [totals, spending] = await Promise.all([
        fec("totals/pac/", [
          ...ids,
          ...[0, 2, 4, 6].map((back): [string, number] => [
            "cycle",
            cycle - back,
          ]),
          ["per_page", 100],
        ]),
        fec("schedules/schedule_b/", [
          ...ids,
          ["two_year_transaction_period", cycle],
          ["disbursement_purpose_category", "CONTRIBUTIONS"],
          ["sort", "-disbursement_date"],
          ["per_page", 100],
        ]),
      ]);
      const rows = fecTotals(totals);
      const contributions = fecContributions(spending);
      const count = z
        .object({ pagination: z.object({ count: z.number() }) })
        .safeParse(spending);
      return {
        ...empty,
        committees: committees.map((row) => ({
          id: row.id,
          name: row.name,
          organization: row.organization,
          lastFiled: row.lastFiled,
          cycles: groupCycles(
            rows.filter((item) => item.committeeId === row.id),
          ),
        })),
        contributions: contributions.slice(0, 100),
        parties: partySplit(contributions),
        sampled: count.success
          ? count.data.pagination.count > contributions.length
          : true,
      };
    },
  });
  return {
    data: cache.value,
    source: SOURCE,
    asOf: latestCoverage(
      cache.value.committees.flatMap((row) =>
        row.cycles.map((c) => c.coverageEnd),
      ),
    ),
    fetchedAt: cache.fetchedAt,
    stale: cache.stale,
  };
}

export async function topPacs(cycle = fecCycle()): Promise<AltResult<PacTop>> {
  const cache = await cached({
    source: SOURCE,
    key: `top:${cycle}`,
    ttlMs: DAY,
    schema: pacTop,
    load: async () => {
      const totals = fecTotals(
        await fec("totals/pac/", [
          ["cycle", cycle],
          ["organization_type", "C"],
          ["committee_type", "Q"],
          ["sort", "-disbursements"],
          ["per_page", 100],
        ]),
      );
      const rows: PacTop["rows"] = [];
      for (const item of totals) {
        const hit = await companyOf([item.committee]);
        if (!hit) continue;
        rows.push({
          committeeId: item.committeeId,
          committee: item.committee,
          ticker: hit.ticker,
          company: hit.name,
          receipts: item.receipts,
          disbursements: item.disbursements,
          contributions: item.contributions,
          coverageEnd: item.coverageEnd,
        });
      }
      return { cycle, scanned: totals.length, rows };
    },
  });
  return {
    data: cache.value,
    source: SOURCE,
    asOf: latestCoverage(cache.value.rows.map((row) => row.coverageEnd)),
    fetchedAt: cache.fetchedAt,
    stale: cache.stale,
  };
}
