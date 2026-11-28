import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { AltBadRequest, AltUnavailable } from "../types";
import {
  archiveUrl,
  efts,
  type FilingRow,
  padCik,
  recentFilings,
  secJson,
  secText,
} from "./edgar";
import {
  applyAmendment,
  diffPositions,
  infoTableCandidates,
  parseCoverPage,
  parseInfoTable,
} from "./parse-13f";
import {
  managerChangesSchema,
  managerHitSchema,
  parsedFilingSchema,
} from "./schemas";
import type {
  FilingRef,
  ManagerChanges,
  ManagerHit,
  ManagerHoldings,
  ManagerRef,
  ParsedFiling,
  Position,
} from "./types";

const FOREVER = Number.POSITIVE_INFINITY;
const POSITION_LIMIT = 1000;
const CHANGE_LIMIT = 400;

const indexSchema = z.object({
  directory: z.object({ item: z.array(z.object({ name: z.string() })) }),
});

const is13F = (form: string) => form === "13F-HR" || form === "13F-HR/A";

export async function loadFiling(cik: string, row: FilingRow) {
  return cached({
    source: "sec-13f",
    key: row.accession,
    ttlMs: FOREVER,
    schema: parsedFilingSchema,
    load: async (): Promise<ParsedFiling> => {
      const [index, coverXml] = await Promise.all([
        secJson(archiveUrl(cik, row.accession, "index.json"), indexSchema),
        secText(archiveUrl(cik, row.accession, "primary_doc.xml")),
      ]);
      const cover = parseCoverPage(coverXml);
      const period = cover.period ?? row.period;
      let positions: Position[] = [];
      for (const file of infoTableCandidates(
        index.directory.item.map((item) => item.name),
      )) {
        const xml = await secText(archiveUrl(cik, row.accession, file), {
          timeoutMs: 120_000,
          maxBytes: 200_000_000,
        });
        if (!/infoTable>/.test(xml)) continue;
        positions = parseInfoTable(xml, period);
        break;
      }
      return {
        cik: padCik(cik),
        managerName: cover.managerName,
        ref: {
          accession: row.accession,
          form: row.form,
          filed: row.filed,
          period,
          amendment: cover.amendment,
        },
        reportedTotal: cover.reportedTotal,
        positions,
      };
    },
  });
}

export const managerFilings = (cik: string, ttlMs?: number) =>
  recentFilings(cik, is13F, "13f", ttlMs);

type PeriodHoldings = {
  filings: FilingRef[];
  period: string;
  filed: string;
  restated: boolean;
  positions: Position[];
  managerName: string;
  fetchedAt: number;
  stale: boolean;
};

async function holdingsAt(
  cik: string,
  rows: FilingRow[],
  period: string,
): Promise<PeriodHoldings> {
  const group = rows
    .filter((row) => row.period === period)
    .sort(
      (a, b) =>
        a.filed.localeCompare(b.filed) ||
        a.accession.localeCompare(b.accession),
    );
  const loaded = await Promise.all(group.map((row) => loadFiling(cik, row)));
  let positions: Position[] = [];
  let restated = false;
  for (const { value } of loaded) {
    if (value.ref.form === "13F-HR") positions = value.positions;
    else if (value.positions.length) {
      positions = applyAmendment(
        positions,
        value.ref.amendment,
        value.positions,
      );
      restated ||= value.ref.amendment !== "NEW HOLDINGS";
    }
  }
  const last = loaded.at(-1);
  return {
    filings: loaded.map(({ value }) => value.ref),
    period,
    filed: last?.value.ref.filed ?? "",
    restated,
    positions,
    managerName:
      loaded.find(({ value }) => value.managerName)?.value.managerName ?? "",
    fetchedAt: Math.min(...loaded.map((item) => item.fetchedAt)),
    stale: loaded.some((item) => item.stale),
  };
}

const periodsOf = (rows: FilingRow[]) =>
  [...new Set(rows.map((row) => row.period).filter(Boolean))].sort((a, b) =>
    b.localeCompare(a),
  );

async function loadManager(cik: string, ttlMs?: number) {
  const list = await managerFilings(cik, ttlMs);
  const periods = periodsOf(list.value.filings);
  if (!periods.length)
    throw new AltUnavailable(
      "This manager has no 13F holdings reports.",
      404,
      false,
    );
  return { list, periods };
}

export type Latest = {
  manager: ManagerRef;
  holdings: PeriodHoldings;
  fetchedAt: number;
  stale: boolean;
};

export async function latestHoldings(
  cik: string,
  ttlMs?: number,
): Promise<Latest> {
  const { list, periods } = await loadManager(cik, ttlMs);
  const holdings = await holdingsAt(cik, list.value.filings, periods[0]);
  return {
    manager: {
      cik: padCik(cik),
      name: holdings.managerName || list.value.name,
    },
    holdings,
    fetchedAt: Math.min(list.fetchedAt, holdings.fetchedAt),
    stale: list.stale || holdings.stale,
  };
}

export function presentHoldings(latest: Latest): ManagerHoldings {
  const { holdings, manager } = latest;
  return {
    manager,
    filings: holdings.filings,
    period: holdings.period,
    filed: holdings.filed,
    restated: holdings.restated,
    positionCount: holdings.positions.length,
    totalValue: holdings.positions.reduce((sum, item) => sum + item.value, 0),
    positions: holdings.positions.slice(0, POSITION_LIMIT),
    truncated: holdings.positions.length > POSITION_LIMIT,
  };
}

export async function managerChanges(
  cik: string,
): Promise<{ value: ManagerChanges; fetchedAt: number; stale: boolean }> {
  const { list, periods } = await loadManager(cik);
  const rows = list.value.filings;
  const [current, previous] = await Promise.all([
    holdingsAt(cik, rows, periods[0]),
    periods[1] ? holdingsAt(cik, rows, periods[1]) : Promise.resolve(null),
  ]);
  const changes = diffPositions(current.positions, previous?.positions ?? []);
  const counts = { new: 0, added: 0, reduced: 0, sold: 0, unchanged: 0 };
  for (const change of changes) counts[change.status]++;
  const ref = (item: PeriodHoldings): FilingRef =>
    item.filings.at(-1) ?? {
      accession: "",
      form: "13F-HR",
      filed: item.filed,
      period: item.period,
      amendment: null,
    };
  const value = managerChangesSchema.parse({
    manager: { cik: padCik(cik), name: current.managerName || list.value.name },
    current: ref(current),
    previous: previous ? ref(previous) : null,
    counts,
    changes: changes
      .filter((change) => change.status !== "unchanged")
      .slice(0, CHANGE_LIMIT),
    truncated: changes.length > CHANGE_LIMIT,
  });
  return {
    value,
    fetchedAt: Math.min(
      list.fetchedAt,
      current.fetchedAt,
      previous?.fetchedAt ?? Number.POSITIVE_INFINITY,
    ),
    stale: list.stale || current.stale || (previous?.stale ?? false),
  };
}

const decode = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const typeaheadSchema = z.object({
  hits: z.object({
    hits: z.array(
      z.object({ _id: z.string(), _source: z.object({ rank: z.number() }) }),
    ),
  }),
});

/** 13F filers matching a name: EDGAR's company search restricted to 13F-HR filers, ordered by EDGAR's own entity popularity. */
export async function searchManagers(query: string) {
  return cached({
    source: "sec-13f-search",
    key: query.toLowerCase(),
    ttlMs: 6 * 3_600_000,
    schema: z.array(managerHitSchema),
    load: async (): Promise<ManagerHit[]> => {
      const feed = await secText(
        `https://www.sec.gov/cgi-bin/browse-edgar?${new URLSearchParams({
          action: "getcompany",
          company: query,
          type: "13F-HR",
          count: "40",
          output: "atom",
        })}`,
      );
      const hits: ManagerHit[] = [];
      const head = feed.slice(0, Math.max(0, feed.indexOf("<entry>")));
      const exact =
        /<cik>(\d+)<\/cik>[\s\S]*?<conformed-name>([^<]*)<\/conformed-name>/.exec(
          head,
        );
      if (exact)
        hits.push({
          cik: exact[1],
          name: decode(exact[2]),
          state: /<state>([A-Z]{2})<\/state>/.exec(head)?.[1] ?? null,
        });
      for (const [, entry] of feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const cik = /<cik>(\d+)<\/cik>/.exec(entry)?.[1];
        const name = /<name>([^<]*)<\/name>/.exec(entry)?.[1];
        if (cik && name)
          hits.push({
            cik,
            name: decode(name),
            state: /<state>([A-Z]{2})<\/state>/.exec(entry)?.[1] ?? null,
          });
      }
      const ranks = new Map<string, number>();
      try {
        const popular = await secJson(
          `https://efts.sec.gov/LATEST/search-index?${new URLSearchParams({ keysTyped: query, forms: "13F-HR" })}`,
          typeaheadSchema,
        );
        for (const hit of popular.hits.hits)
          ranks.set(padCik(hit._id), hit._source.rank);
      } catch {
        // Ordering by popularity is a refinement; the company search alone still answers.
      }
      const lower = query.toLowerCase();
      return hits.sort(
        (a, b) =>
          (ranks.get(b.cik) ?? 0) - (ranks.get(a.cik) ?? 0) ||
          Number(b.name.toLowerCase().startsWith(lower)) -
            Number(a.name.toLowerCase().startsWith(lower)),
      );
    },
  });
}

/** Accepts a CIK or a name; a name takes the best search hit. */
export async function resolveManagerCik(
  params: URLSearchParams,
): Promise<string> {
  const cik = params.get("cik")?.trim();
  if (cik) {
    if (!/^\d{1,10}$/.test(cik))
      throw new AltBadRequest("cik must be 1 to 10 digits.");
    return padCik(cik);
  }
  const name = (params.get("name") ?? params.get("q") ?? "").trim();
  if (name.length < 2)
    throw new AltBadRequest(
      "Give a manager CIK or a name of at least two characters.",
    );
  if (/^\d{4,10}$/.test(name)) return padCik(name);
  const [best] = (await searchManagers(name)).value;
  if (!best)
    throw new AltUnavailable(`No 13F filer matches "${name}".`, 404, false);
  return padCik(best.cik);
}

/** Filers that reported a CUSIP in the current filing window, from EDGAR full-text search. */
export async function filersReporting(
  cusip: string,
  since: string,
): Promise<number | null> {
  try {
    const result = await efts({
      q: `"${cusip}"`,
      forms: "13F-HR",
      dateRange: "custom",
      startdt: since,
      enddt: new Date().toISOString().slice(0, 10),
    });
    return result.total.value;
  } catch (error) {
    console.warn("Stockwatcher 13F filer count failed", {
      error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
    });
    return null;
  }
}
