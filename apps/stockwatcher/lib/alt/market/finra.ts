import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { altText } from "../http";
import { AltBadRequest, type AltResult, AltUnavailable } from "../types";
import { mean, zScore } from "./stats";
import type {
  AtsSeries,
  AtsWeek,
  OffExchangePoint,
  OffExchangeSeries,
  OffExchangeTop,
} from "./types";

const SOURCE = "finra-regsho";
const MIN_ROW_VOLUME = 10_000;
const FILE = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol";

const dayRows = z.array(
  z.tuple([z.string(), z.number(), z.number(), z.number()]),
);
type DayRows = z.infer<typeof dayRows>;

/** Pipe-delimited Reg SHO file to [symbol, short, exempt, total] rows, dropping thin symbols. */
export function parseRegSho(text: string): DayRows {
  const rows: DayRows = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [, symbol, short, exempt, total] = line.split("|");
    if (!symbol || total === undefined) continue;
    const totalVolume = Number(total);
    const shortVolume = Number(short);
    if (!Number.isFinite(totalVolume) || !Number.isFinite(shortVolume))
      continue;
    if (totalVolume < MIN_ROW_VOLUME) continue;
    rows.push([symbol, shortVolume, Number(exempt) || 0, totalVolume]);
  }
  return rows;
}

const compactDate = (date: string) => date.replaceAll("-", "");

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Newest-first weekdays ending at `from`. */
export function weekdaysBack(from: Date, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(from);
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(isoDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

const missing = new Set<string>();
const memory = new Map<string, DayRows>();

async function loadDay(date: string): Promise<DayRows | null> {
  const known = memory.get(date);
  if (known) return known;
  if (missing.has(date)) return null;
  try {
    const { value } = await cached({
      source: SOURCE,
      key: date,
      ttlMs: Number.POSITIVE_INFINITY,
      schema: dayRows,
      load: async () => {
        const text = await altText(
          "FINRA Reg SHO",
          `${FILE}${compactDate(date)}.txt`,
          { timeoutMs: 30_000, maxBytes: 8_000_000 },
        );
        const rows = parseRegSho(text);
        if (!rows.length)
          throw new AltUnavailable("FINRA Reg SHO file was empty.", 404, false);
        return rows;
      },
    });
    if (memory.size > 40) memory.delete(memory.keys().next().value ?? "");
    memory.set(date, value);
    return value;
  } catch (error) {
    if (
      error instanceof AltUnavailable &&
      /HTTP 40[34]\b|empty/.test(error.message)
    ) {
      if (Date.now() - Date.parse(date) > 4 * 86_400_000) missing.add(date);
      return null;
    }
    throw error;
  }
}

/** The most recent `count` published trading days, newest first. */
async function publishedDays(count: number) {
  const out: { date: string; rows: DayRows }[] = [];
  // Holidays and the unpublished current evening answer 404; look a bit past `count` weekdays.
  const candidates = weekdaysBack(new Date(), count + 8);
  for (let i = 0; i < candidates.length && out.length < count; i += 6) {
    const batch = await Promise.all(
      candidates.slice(i, i + 6).map(async (date) => ({
        date,
        rows: await loadDay(date),
      })),
    );
    for (const day of batch)
      if (day.rows && out.length < count)
        out.push({ date: day.date, rows: day.rows });
  }
  if (!out.length)
    throw new AltUnavailable("FINRA Reg SHO files are unavailable.");
  return out;
}

const point = (date: string, row: DayRows[number]): OffExchangePoint => ({
  date,
  shortVolume: row[1],
  shortExemptVolume: row[2],
  totalVolume: row[3],
  dpi: row[3] > 0 ? row[1] / row[3] : 0,
});

export function buildSeries(
  symbol: string,
  days: { date: string; rows: DayRows }[],
): OffExchangeSeries {
  const points = days
    .map((day) => {
      const row = day.rows.find((r) => r[0] === symbol);
      return row ? point(day.date, row) : null;
    })
    .filter((p): p is OffExchangePoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1) ?? null;
  const prior = points.slice(0, -1).map((p) => p.dpi);
  return {
    symbol,
    points,
    latest,
    baselineDpi: mean(prior),
    dpiZScore: latest && prior.length >= 5 ? zScore(latest.dpi, prior) : null,
  };
}

const symbolPattern = /^[A-Z][A-Z0-9.-]{0,9}$/;

export async function offExchangeTicker(
  rawSymbol: string,
  days: number,
): Promise<AltResult<OffExchangeSeries>> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbolPattern.test(symbol)) throw new AltBadRequest("Invalid symbol.");
  const published = await publishedDays(Math.min(Math.max(days, 5), 60));
  const data = buildSeries(symbol, published);
  if (!data.points.length)
    throw new AltUnavailable(
      `No FINRA off-exchange volume for ${symbol} in this window.`,
      404,
      false,
    );
  return {
    data,
    source: "FINRA Reg SHO daily short sale volume",
    asOf: published[0].date,
    fetchedAt: Date.now(),
    stale: false,
  };
}

export async function offExchangeTop(
  sort: "dpi" | "volume",
  limit: number,
  minVolume: number,
): Promise<AltResult<OffExchangeTop>> {
  const [latest] = await publishedDays(1);
  const rows = latest.rows
    .filter((r) => r[3] >= minVolume && !r[0].includes("."))
    .map((r) => ({
      symbol: r[0],
      date: latest.date,
      shortVolume: r[1],
      totalVolume: r[3],
      dpi: r[1] / r[3],
    }))
    .sort((a, b) =>
      sort === "dpi" ? b.dpi - a.dpi : b.totalVolume - a.totalVolume,
    )
    .slice(0, limit);
  return {
    data: { date: latest.date, sort, minVolume, rows },
    source: "FINRA Reg SHO daily short sale volume",
    asOf: latest.date,
    fetchedAt: Date.now(),
    stale: false,
  };
}

const atsRow = z.object({
  weekStartDate: z.string(),
  summaryTypeCode: z.string(),
  totalWeeklyShareQuantity: z.number().nullable(),
  totalWeeklyTradeCount: z.number().nullable(),
  totalNotionalSum: z.number().nullable(),
});
const atsDoc = z.array(atsRow);

export function foldAts(rows: z.infer<typeof atsDoc>): AtsWeek[] {
  const weeks = new Map<string, AtsWeek>();
  for (const row of rows) {
    const ats = row.summaryTypeCode === "ATS_W_SMBL";
    if (!ats && row.summaryTypeCode !== "OTC_W_SMBL") continue;
    const week =
      weeks.get(row.weekStartDate) ??
      ({
        weekStart: row.weekStartDate,
        atsShares: null,
        atsTrades: null,
        atsNotional: null,
        nonAtsShares: null,
        nonAtsTrades: null,
        nonAtsNotional: null,
      } satisfies AtsWeek);
    const [shares, trades, notional] = [
      row.totalWeeklyShareQuantity,
      row.totalWeeklyTradeCount,
      row.totalNotionalSum,
    ];
    if (ats)
      Object.assign(week, {
        atsShares: shares,
        atsTrades: trades,
        atsNotional: notional,
      });
    else
      Object.assign(week, {
        nonAtsShares: shares,
        nonAtsTrades: trades,
        nonAtsNotional: notional,
      });
    weeks.set(row.weekStartDate, week);
  }
  return [...weeks.values()].sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  );
}

/** Weekly ATS and non-ATS OTC totals; FINRA publishes Tier 1 about three weeks late. */
export async function atsTicker(
  rawSymbol: string,
): Promise<AltResult<AtsSeries>> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbolPattern.test(symbol)) throw new AltBadRequest("Invalid symbol.");
  const since = isoDay(new Date(Date.now() - 100 * 86_400_000));
  const { value, fetchedAt, stale } = await cached({
    source: "finra-ats",
    key: `${symbol}:${since.slice(0, 7)}`,
    ttlMs: 12 * 3_600_000,
    schema: atsDoc,
    load: async () => {
      const query = async (summaryTypeCode: string) => {
        const text = await altText(
          "FINRA OTC Transparency",
          "https://api.finra.org/data/group/otcMarket/name/weeklySummary",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              limit: 50,
              fields: [
                "weekStartDate",
                "summaryTypeCode",
                "totalWeeklyShareQuantity",
                "totalWeeklyTradeCount",
                "totalNotionalSum",
              ],
              compareFilters: [
                {
                  compareType: "EQUAL",
                  fieldName: "issueSymbolIdentifier",
                  fieldValue: symbol,
                },
                {
                  compareType: "EQUAL",
                  fieldName: "summaryTypeCode",
                  fieldValue: summaryTypeCode,
                },
                {
                  compareType: "GREATER",
                  fieldName: "weekStartDate",
                  fieldValue: since,
                },
              ],
            }),
          },
        );
        return text.trim() ? atsDoc.parse(JSON.parse(text)) : [];
      };
      const [ats, otc] = await Promise.all([
        query("ATS_W_SMBL"),
        query("OTC_W_SMBL"),
      ]);
      return [...ats, ...otc];
    },
  });
  const weeks = foldAts(value);
  return {
    data: { symbol, weeks },
    source: "FINRA OTC Transparency weekly summary",
    asOf: weeks.at(-1)?.weekStart ?? null,
    fetchedAt,
    stale,
  };
}
