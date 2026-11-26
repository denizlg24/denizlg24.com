import "server-only";

export const curveTenors = [
  "1M",
  "2M",
  "3M",
  "4M",
  "6M",
  "1Y",
  "2Y",
  "3Y",
  "5Y",
  "7Y",
  "10Y",
  "20Y",
  "30Y",
] as const;

export type CurveTenor = (typeof curveTenors)[number];
export type CurvePoint = {
  date: string;
  yields: Partial<Record<CurveTenor, number>>;
};

const HEADER_TENORS: Record<string, CurveTenor> = {
  "1 Mo": "1M",
  "2 Mo": "2M",
  "3 Mo": "3M",
  "4 Mo": "4M",
  "6 Mo": "6M",
  "1 Yr": "1Y",
  "2 Yr": "2Y",
  "3 Yr": "3Y",
  "5 Yr": "5Y",
  "7 Yr": "7Y",
  "10 Yr": "10Y",
  "20 Yr": "20Y",
  "30 Yr": "30Y",
};

const TTL_MS = 1_800_000;
const cache = new Map<number, { at: number; rows: CurvePoint[] }>();

const splitCsvLine = (line: string) =>
  line.split(",").map((cell) => cell.replaceAll('"', "").trim());

async function yearRows(year: number) {
  const hit = cache.get(year);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Stockwatcher)" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Treasury returned HTTP ${response.status}.`);
  const [header, ...lines] = (await response.text()).trim().split("\n");
  const columns = splitCsvLine(header);
  const rows: CurvePoint[] = [];
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const [month, day, fullYear] = (cells[0] ?? "").split("/");
    if (!fullYear) continue;
    const yields: Partial<Record<CurveTenor, number>> = {};
    columns.forEach((column, index) => {
      const tenor = HEADER_TENORS[column];
      const value = Number(cells[index]);
      if (tenor && cells[index] !== "" && Number.isFinite(value))
        yields[tenor] = value;
    });
    rows.push({ date: `${fullYear}-${month}-${day}`, yields });
  }
  cache.set(year, { at: Date.now(), rows });
  return rows;
}

const shift = (
  date: string,
  offset: { days?: number; months?: number; years?: number },
) => {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCFullYear(result.getUTCFullYear() - (offset.years ?? 0));
  result.setUTCMonth(result.getUTCMonth() - (offset.months ?? 0));
  result.setUTCDate(result.getUTCDate() - (offset.days ?? 0));
  return result.toISOString().slice(0, 10);
};

export const comparisonOffsets = {
  "1w": { days: 7 },
  "1m": { months: 1 },
  "3m": { months: 3 },
  "6m": { months: 6 },
  "1y": { years: 1 },
  "2y": { years: 2 },
} as const;

export type ComparisonKey = keyof typeof comparisonOffsets;

export async function yieldCurve(compare: ComparisonKey[], on?: string) {
  const thisYear = new Date().getUTCFullYear();
  const targetYear = on ? Number(on.slice(0, 4)) : thisYear;
  const rows = await yearRows(targetYear);
  let latest = on ? rows.find((row) => row.date <= on) : rows[0];
  if (!latest) latest = (await yearRows(targetYear - 1))[0];
  if (!latest)
    throw new Error(
      on
        ? `No Treasury curve on or before ${on}.`
        : "No Treasury curve is available.",
    );
  const curves: Array<
    { label: string; requested: string | null } & CurvePoint
  > = [{ label: "latest", requested: on ?? null, ...latest }];
  for (const key of compare) {
    const wanted = shift(latest.date, comparisonOffsets[key]);
    const pool = await yearRows(Number(wanted.slice(0, 4)));
    const found = pool.find((row) => row.date <= wanted);
    const earlier =
      found ?? (await yearRows(Number(wanted.slice(0, 4)) - 1))[0];
    if (earlier) curves.push({ label: key, requested: wanted, ...earlier });
  }
  return curves;
}
