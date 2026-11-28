import "server-only";
import { lookupCik } from "../../sec-data";
import { AltBadRequest, AltUnavailable } from "../types";
import { topFilers } from "./bulk";
import { cusipFor } from "./cusip";
import type { FilingRow } from "./edgar";
import { applyAmendment } from "./parse-13f";
import { filersReporting, loadFiling, managerFilings } from "./thirteenf";
import type {
  ChangeStatus,
  Holder,
  InstitutionalHolders,
  Position,
} from "./types";

const CHECKED = 80;
const CONCURRENCY = 8;
const DEADLINE_MS = 28_000;

async function pool<T>(
  items: T[],
  size: number,
  run: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

async function positionsAt(cik: string, rows: FilingRow[], period: string) {
  const group = rows
    .filter((row) => row.period === period)
    .sort(
      (a, b) =>
        a.filed.localeCompare(b.filed) ||
        a.accession.localeCompare(b.accession),
    );
  let positions: Position[] = [];
  let filed = "";
  let accession = "";
  let fetchedAt = Number.POSITIVE_INFINITY;
  let stale = false;
  for (const loaded of await Promise.all(
    group.map((row) => loadFiling(cik, row)),
  )) {
    const { value } = loaded;
    if (value.ref.form === "13F-HR") positions = value.positions;
    else if (value.positions.length)
      positions = applyAmendment(
        positions,
        value.ref.amendment,
        value.positions,
      );
    filed = value.ref.filed;
    accession = value.ref.accession;
    fetchedAt = Math.min(fetchedAt, loaded.fetchedAt);
    stale ||= loaded.stale;
  }
  return { positions, filed, accession, fetchedAt, stale };
}

const stockRows = (positions: Position[], cusip: string) =>
  positions.filter(
    (item) => item.cusip === cusip && !item.putCall && item.shareType === "SH",
  );

const sum = (rows: Position[], field: "shares" | "value") =>
  rows.reduce((total, row) => total + row[field], 0);

function statusOf(now: number, before: number | null): ChangeStatus | null {
  if (before === null) return null;
  if (before === 0) return now > 0 ? "new" : "unchanged";
  return now > before ? "added" : now < before ? "reduced" : "unchanged";
}

type Targets = { symbol: string; cik: string; name: string };

async function target(symbol: string): Promise<Targets> {
  const company = await lookupCik(symbol);
  if (!company)
    throw new AltUnavailable(`${symbol} is not an SEC registrant.`, 404, false);
  return { symbol, ...company };
}

/**
 * Top institutional holders of a ticker. EDGAR has no reverse index from
 * security to holders outside the quarterly bulk set (which trails by one to
 * three months), so this checks the largest 13F filers' own reports for the
 * company's CUSIP: current quarter straight from EDGAR, previous quarter for
 * the change. Reports are cached by accession, so a repeat is instant; a first
 * call returns what finished inside the deadline and says how many are pending.
 */
export async function institutionalHolders(
  symbolInput: string,
  limit = 25,
): Promise<{ value: InstitutionalHolders; fetchedAt: number; stale: boolean }> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol))
    throw new AltBadRequest("symbol is not a valid ticker.");
  const [company, filers] = await Promise.all([target(symbol), topFilers()]);
  const candidates = filers.value.filers.slice(0, CHECKED);

  const lists = new Map<string, FilingRow[]>();
  await pool(candidates, CONCURRENCY, async (filer) => {
    try {
      lists.set(
        filer.cik,
        (await managerFilings(filer.cik, 6 * 3_600_000)).value.filings,
      );
    } catch {
      // An unreachable filer is counted as pending below.
    }
  });
  const counts = new Map<string, number>();
  for (const rows of lists.values())
    for (const period of new Set(rows.map((row) => row.period).filter(Boolean)))
      counts.set(period, (counts.get(period) ?? 0) + 1);
  const quorum = Math.ceil(lists.size * 0.4);
  const period = [...counts.entries()]
    .filter(([, count]) => count >= quorum)
    .map(([key]) => key)
    .sort((a, b) => b.localeCompare(a))[0];
  if (!period)
    throw new AltUnavailable("No 13F reports are available right now.");

  const cusip = await cusipFor(symbol, company.cik, company.name, async () => {
    const largest: Position[][] = [];
    for (const filer of candidates.slice(0, 4)) {
      const rows = lists.get(filer.cik);
      const own = rows
        ? [...new Set(rows.map((row) => row.period))].sort().reverse()[0]
        : null;
      if (rows && own)
        largest.push((await positionsAt(filer.cik, rows, own)).positions);
    }
    return largest;
  });

  const since = new Date(Date.parse(period) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const total = filersReporting(cusip, since);

  const holders: Holder[] = [];
  let checked = 0;
  let fetchedAt = Date.now();
  let stale = false;
  const work = pool(candidates, CONCURRENCY, async (filer) => {
    const rows = lists.get(filer.cik);
    if (!rows) return;
    try {
      const periods = [
        ...new Set(rows.map((row) => row.period).filter(Boolean)),
      ].sort((a, b) => b.localeCompare(a));
      const own = periods.find((item) => item <= period);
      if (!own) return;
      const [now, before] = await Promise.all([
        positionsAt(filer.cik, rows, own),
        periods.find((item) => item < own)
          ? positionsAt(
              filer.cik,
              rows,
              periods.find((item) => item < own) as string,
            )
          : Promise.resolve(null),
      ]);
      checked++;
      fetchedAt = Math.min(fetchedAt, now.fetchedAt);
      stale ||= now.stale;
      const held = stockRows(now.positions, cusip);
      const previousShares = before
        ? sum(stockRows(before.positions, cusip), "shares")
        : null;
      if (!held.length && !previousShares) return;
      const shares = sum(held, "shares");
      const portfolio = sum(now.positions, "value");
      holders.push({
        cik: filer.cik,
        name: filer.name,
        period: own,
        filed: now.filed,
        accession: now.accession,
        shares,
        value: sum(held, "value"),
        portfolioPercent:
          portfolio > 0 ? (sum(held, "value") / portfolio) * 100 : null,
        previousShares,
        sharesChange: previousShares === null ? null : shares - previousShares,
        sharesChangePercent:
          previousShares && previousShares > 0
            ? ((shares - previousShares) / previousShares) * 100
            : null,
        status: statusOf(shares, previousShares),
        lagging: own !== period,
      });
    } catch (error) {
      console.warn("Stockwatcher 13F holder check failed", {
        cik: filer.cik,
        error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      });
    }
  });
  await Promise.race([
    work,
    new Promise((resolve) => setTimeout(resolve, DEADLINE_MS)),
  ]);

  const present = holders
    .filter((holder) => holder.shares > 0)
    .sort((a, b) => b.value - a.value);
  return {
    value: {
      symbol,
      name: company.name,
      cusip,
      period,
      holders: present.slice(0, limit),
      coverage: {
        filersChecked: checked,
        filersWithPosition: present.length,
        filersTotal: await total,
        pending: candidates.length - checked,
        rankedBy: `Largest 13F filers by reported portfolio value (SEC Form 13F data set, ${filers.value.period})`,
      },
      totalShares: present.reduce((total, holder) => total + holder.shares, 0),
      totalValue: present.reduce((total, holder) => total + holder.value, 0),
    },
    fetchedAt,
    stale,
  };
}
