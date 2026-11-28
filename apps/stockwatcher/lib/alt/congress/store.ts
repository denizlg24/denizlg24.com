import "server-only";
import { cached } from "../cache";
import { resolveName } from "../entities";
import { AltUnavailable } from "../types";
import { houseAnnual, houseDocumentUrl, houseIndex, housePtr } from "./house";
import type { HouseIndexEntry } from "./house-parse";
import { legislators } from "./legislators";
import { displayName, type Legislator, matchLegislator } from "./match";
import { ogeKey, trumpListings, trumpReport } from "./oge";
import { type Budget, BudgetSpent, mapLimit } from "./pool";
import {
  type Aggregate,
  aggregate,
  annualAggregate,
  type PtrDocument,
  type StoredNetWorth,
} from "./schemas";
import {
  senateAnnualList,
  senateDocumentUrl,
  senatePtr,
  senatePtrList,
} from "./senate";
import type { Chamber, Filing, Trade } from "./types";

type Stored = Aggregate["trades"][number];

const STOCK_LIKE = new Set(["ST", "OP", "PS", "CS", "Stock", "Stock Option"]);

async function tickerFor(
  asset: string,
  assetType: string | null,
  known: string | null,
) {
  if (known) return known;
  if (assetType && !STOCK_LIKE.has(assetType)) return null;
  try {
    const hit = await resolveName(asset);
    return hit && hit.match !== "prefix" ? hit.ticker : null;
  } catch {
    return null;
  }
}

const letters = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

async function roster(): Promise<{
  list: Legislator[];
  warning: string | null;
}> {
  try {
    return { list: (await legislators()).value, warning: null };
  } catch {
    return {
      list: [],
      warning:
        "Member roster unavailable; filers are not matched to bioguide ids.",
    };
  }
}

async function houseYear(year: number, budget: Budget): Promise<Aggregate> {
  const [index, { list, warning }] = await Promise.all([
    houseIndex(year),
    roster(),
  ]);
  const entries = index.value
    .filter((entry) => entry.type === "P")
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  const trades: Stored[] = [];
  const filings: Aggregate["filings"] = [];
  let pending = 0;
  await mapLimit(entries, 3, async (entry) => {
    const state = entry.stateDst.slice(0, 2) || null;
    const member = matchLegislator(list, {
      first: entry.first,
      last: entry.last,
      chamber: "house",
      state,
    });
    const filer =
      member?.name ?? displayName(entry.first, entry.last, entry.suffix);
    const url = houseDocumentUrl("ptr", entry.year, entry.docId);
    let doc: PtrDocument;
    try {
      doc = (await housePtr(entry, budget)).value;
    } catch (error) {
      if (!(error instanceof BudgetSpent) && !(error instanceof AltUnavailable))
        throw error;
      pending++;
      filings.push({
        id: entry.docId,
        chamber: "house",
        kind: "ptr",
        filer,
        bioguide: member?.bioguide ?? null,
        state,
        filedAt: entry.filedAt,
        url,
        parsed: false,
        tradeCount: 0,
        reason: error instanceof BudgetSpent ? "queued" : error.message,
      });
      return;
    }
    filings.push({
      id: entry.docId,
      chamber: "house",
      kind: "ptr",
      filer,
      bioguide: member?.bioguide ?? null,
      state,
      filedAt: entry.filedAt,
      url,
      parsed: doc.parsed,
      tradeCount: doc.trades.length,
      reason: doc.reason,
    });
    for (const [i, raw] of doc.trades.entries())
      trades.push({
        ...raw,
        ticker: await tickerFor(raw.asset, raw.assetType, raw.ticker),
        id: `house:${entry.docId}:${i}`,
        chamber: "house",
        filingId: entry.docId,
        filedAt: entry.filedAt,
        filer,
        bioguide: member?.bioguide ?? null,
        party: member?.party ?? null,
        state: member?.state ?? state,
        url,
        ocr: false,
      });
  });
  return { trades, filings, pending, warnings: warning ? [warning] : [] };
}

async function senateAll(budget: Budget): Promise<Aggregate> {
  const [list, { list: members, warning }] = await Promise.all([
    senatePtrList(),
    roster(),
  ]);
  const trades: Stored[] = [];
  const filings: Aggregate["filings"] = [];
  let pending = 0;
  await mapLimit(list.value, 2, async (listing) => {
    const member = matchLegislator(members, {
      first: listing.first,
      last: listing.last,
      chamber: "senate",
    });
    const filer = member?.name ?? displayName(listing.first, listing.last);
    const url = senateDocumentUrl(listing.path);
    const base = {
      id: listing.uuid,
      chamber: "senate" as const,
      kind: "ptr" as const,
      filer,
      bioguide: member?.bioguide ?? null,
      state: member?.state ?? null,
      filedAt: listing.filedAt,
      url,
    };
    let doc: PtrDocument;
    try {
      doc = (await senatePtr(listing, budget)).value;
    } catch (error) {
      if (!(error instanceof BudgetSpent) && !(error instanceof AltUnavailable))
        throw error;
      pending++;
      filings.push({
        ...base,
        parsed: false,
        tradeCount: 0,
        reason: error instanceof BudgetSpent ? "queued" : error.message,
      });
      return;
    }
    filings.push({
      ...base,
      parsed: doc.parsed,
      tradeCount: doc.trades.length,
      reason: doc.reason,
    });
    for (const [i, raw] of doc.trades.entries())
      trades.push({
        ...raw,
        ticker: await tickerFor(raw.asset, raw.assetType, raw.ticker),
        id: `senate:${listing.uuid}:${i}`,
        chamber: "senate",
        filingId: listing.uuid,
        filedAt: listing.filedAt,
        filer,
        bioguide: member?.bioguide ?? null,
        party: member?.party ?? null,
        state: member?.state ?? null,
        url,
        ocr: false,
      });
  });
  return { trades, filings, pending, warnings: warning ? [warning] : [] };
}

async function executiveAll(budget: Budget): Promise<Aggregate> {
  const list = await trumpListings();
  const trades: Stored[] = [];
  const filings: Aggregate["filings"] = [];
  let pending = 0;
  const recent = list.value.slice(0, 30);
  await mapLimit(recent, 2, async (listing) => {
    const id = ogeKey(listing.url);
    const base = {
      id,
      chamber: "executive" as const,
      kind: "ptr" as const,
      filer: "Donald J. Trump",
      bioguide: null,
      state: null,
      filedAt: listing.filedAt,
      url: listing.url,
    };
    try {
      const doc = (await trumpReport(listing, budget)).value;
      filings.push({
        ...base,
        parsed: doc.parsed,
        tradeCount: doc.rows.length,
        reason: doc.reason,
      });
      for (const [i, row] of doc.rows.entries())
        trades.push({
          ...row,
          owner: null,
          ticker: await tickerFor(row.asset, null, null),
          assetType: null,
          notifiedAt: null,
          note: doc.skipped
            ? `OCR: ${doc.skipped} unreadable rows in this report`
            : null,
          id: `executive:${id}:${i}`,
          chamber: "executive",
          filingId: id,
          filedAt: listing.filedAt,
          filer: "Donald J. Trump",
          bioguide: null,
          party: "Republican",
          state: null,
          url: listing.url,
          ocr: true,
        });
    } catch (error) {
      if (!(error instanceof BudgetSpent) && !(error instanceof AltUnavailable))
        throw error;
      pending++;
      filings.push({
        ...base,
        parsed: false,
        tradeCount: 0,
        reason: error instanceof BudgetSpent ? "queued" : error.message,
      });
    }
  });
  return { trades, filings, pending, warnings: [] };
}

export type Feed = {
  trades: Trade[];
  filings: Filing[];
  pending: number;
  warnings: string[];
  fetchedAt: number;
  stale: boolean;
  asOf: string | null;
};

const merge = (
  parts: { value: Aggregate; fetchedAt: number; stale: boolean }[],
): Feed => {
  const trades = parts.flatMap((p) => p.value.trades);
  const filings = parts.flatMap((p) => p.value.filings);
  trades.sort(
    (a, b) =>
      b.filedAt.localeCompare(a.filedAt) ||
      (b.transactedAt ?? "").localeCompare(a.transactedAt ?? ""),
  );
  filings.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  return {
    trades,
    filings,
    pending: parts.reduce((sum, p) => sum + p.value.pending, 0),
    warnings: [...new Set(parts.flatMap((p) => p.value.warnings))],
    fetchedAt: Math.min(...parts.map((p) => p.fetchedAt)),
    stale: parts.some((p) => p.stale),
    asOf: filings[0]?.filedAt ?? null,
  };
};

const currentYear = () => new Date().getFullYear();

/**
 * Senate eFD answers 403 (Akamai) to every client tried from the owner's
 * networks, so the Senate side stays off unless a host that can reach it
 * sets CONGRESS_SENATE=1.
 */
export const senateEnabled = () => process.env.CONGRESS_SENATE === "1";

/** Aggregates are per source so one publisher being down does not hide the others. */
async function part(
  label: string,
  key: string,
  ttlMs: number,
  load: () => Promise<Aggregate>,
  warnings: string[],
) {
  try {
    return await cached({
      source: "congress.agg",
      key,
      ttlMs,
      schema: aggregate,
      load,
    });
  } catch (error) {
    warnings.push(
      `${label}: ${error instanceof Error ? error.message : "unavailable"}`,
    );
    return null;
  }
}

export async function congressFeed(options: {
  chamber: Chamber | "all";
  budget: Budget;
}): Promise<Feed> {
  const { chamber, budget } = options;
  const warnings: string[] = [];
  const jobs: Promise<{
    value: Aggregate;
    fetchedAt: number;
    stale: boolean;
  } | null>[] = [];
  if (chamber === "house" || chamber === "all")
    for (const year of [currentYear(), currentYear() - 1])
      jobs.push(
        part(
          `House ${year}`,
          `house:${year}`,
          year === currentYear() ? 60_000 : 30 * 60_000,
          () => houseYear(year, budget),
          warnings,
        ),
      );
  if (senateEnabled() && (chamber === "senate" || chamber === "all"))
    jobs.push(
      part("Senate", "senate", 60_000, () => senateAll(budget), warnings),
    );
  if (chamber === "executive")
    jobs.push(
      part(
        "OGE",
        "executive",
        5 * 60_000,
        () => executiveAll(budget),
        warnings,
      ),
    );
  const parts = (await Promise.all(jobs)).filter((p) => p !== null);
  if (!parts.length)
    throw new AltUnavailable(
      warnings.join(" ") || "Congressional disclosures are unavailable.",
    );
  const feed = merge(parts);
  feed.warnings.push(...warnings);
  return feed;
}

/** Force a rebuild of every aggregate, used by the warmers; `budget` caps new documents per run. */
export async function refreshCongress(budget: Budget) {
  const results = await Promise.allSettled([
    ...[currentYear(), currentYear() - 1].map((year) =>
      houseYear(year, budget).then((agg) =>
        cacheAggregate(`house:${year}`, agg),
      ),
    ),
    ...(senateEnabled()
      ? [senateAll(budget).then((agg) => cacheAggregate("senate", agg))]
      : []),
    executiveAll(budget).then((agg) => cacheAggregate("executive", agg)),
  ]);
  return results.map((r) => r.status);
}

async function cacheAggregate(key: string, value: Aggregate) {
  await cached({
    source: "congress.agg",
    key,
    ttlMs: 0,
    schema: aggregate,
    load: async () => value,
  });
  return value.trades.length;
}

const mid = (min: number | null, max: number | null) =>
  min == null ? null : max == null ? min : (min + max) / 2;

export { mid };

async function houseAnnualEntries(): Promise<HouseIndexEntry[]> {
  const out: HouseIndexEntry[] = [];
  for (const year of [currentYear(), currentYear() - 1, currentYear() - 2]) {
    try {
      out.push(
        ...(await houseIndex(year)).value.filter((entry) => entry.type === "O"),
      );
    } catch {
      /* a year the Clerk has not published yet */
    }
  }
  return out;
}

function toNetWorth(
  entry: HouseIndexEntry,
  member: Legislator | null,
  doc: Awaited<ReturnType<typeof houseAnnual>>["value"],
): StoredNetWorth {
  const netWorthMid =
    doc.assetsMid == null ? null : doc.assetsMid - (doc.liabilitiesMid ?? 0);
  return {
    filingId: entry.docId,
    year: entry.year,
    filedAt: entry.filedAt,
    url: houseDocumentUrl("annual", entry.year, entry.docId),
    chamber: "house",
    filer: member?.name ?? displayName(entry.first, entry.last, entry.suffix),
    bioguide: member?.bioguide ?? null,
    assetsMid: doc.assetsMid,
    liabilitiesMid: doc.liabilitiesMid,
    netWorthMid: doc.parsed ? netWorthMid : null,
    assetsLow: doc.assetsLow,
    assetsHigh: doc.assetsHigh,
    holdings: doc.holdings.slice(0, 250),
    holdingsCount: doc.holdings.length,
    flags: doc.parsed ? doc.flags : ["scanned or unreadable filing"],
  };
}

async function buildAnnual(budget: Budget) {
  const [entries, { list }] = await Promise.all([
    houseAnnualEntries(),
    roster(),
  ]);
  const latest = new Map<string, HouseIndexEntry>();
  for (const entry of entries) {
    const key = `${letters(entry.last)}:${letters(entry.first)}:${entry.stateDst}`;
    const held = latest.get(key);
    if (!held || entry.filedAt > held.filedAt) latest.set(key, entry);
  }
  const reports: StoredNetWorth[] = [];
  let pending = 0;
  await mapLimit([...latest.values()], 3, async (entry) => {
    const member = matchLegislator(list, {
      first: entry.first,
      last: entry.last,
      chamber: "house",
      state: entry.stateDst.slice(0, 2),
    });
    if (!member) return;
    try {
      reports.push(
        toNetWorth(entry, member, (await houseAnnual(entry, budget)).value),
      );
    } catch (error) {
      if (!(error instanceof BudgetSpent) && !(error instanceof AltUnavailable))
        throw error;
      pending++;
    }
  });
  if (!reports.length && pending)
    throw new AltUnavailable("Annual reports are not read yet.", 503);
  return { reports, pending };
}

export async function houseAnnualReports(budget: Budget) {
  const entry = await cached({
    source: "congress.agg",
    key: "annual:house",
    ttlMs: 30 * 60_000,
    schema: annualAggregate,
    load: () => buildAnnual(budget),
  });
  return entry.value;
}

export async function refreshAnnual(budget: Budget) {
  const built = await buildAnnual(budget);
  await cached({
    source: "congress.agg",
    key: "annual:house",
    ttlMs: 0,
    schema: annualAggregate,
    load: async () => built,
  });
  return built.reports.length;
}

/** Latest annual report for one sitting House member, reading at most one new document. */
export async function houseNetWorth(
  member: Legislator,
  budget: Budget,
): Promise<StoredNetWorth | null> {
  const stored = (
    await houseAnnualReports({ documents: 0, deadline: 0 }).catch(() => null)
  )?.reports.find((report) => report.bioguide === member.bioguide);
  if (stored) return stored;
  const entries = (await houseAnnualEntries())
    .filter(
      (entry) =>
        entry.stateDst.slice(0, 2) === member.state &&
        matchLegislator([member], {
          first: entry.first,
          last: entry.last,
          chamber: "house",
          state: member.state,
        }),
    )
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  const entry = entries[0];
  if (!entry) return null;
  return toNetWorth(entry, member, (await houseAnnual(entry, budget)).value);
}

export async function senateAnnualFilings(
  member: Legislator,
): Promise<Filing[]> {
  const list = await senateAnnualList();
  return list.value
    .filter((listing) =>
      matchLegislator([member], {
        first: listing.first,
        last: listing.last,
        chamber: "senate",
      }),
    )
    .map((listing) => ({
      id: listing.uuid,
      chamber: "senate" as const,
      kind: "annual" as const,
      filer: member.name,
      bioguide: member.bioguide,
      state: member.state,
      filedAt: listing.filedAt,
      url: senateDocumentUrl(listing.path),
      parsed: false,
      tradeCount: 0,
      reason: "Senate annual reports are linked, not parsed",
    }));
}
