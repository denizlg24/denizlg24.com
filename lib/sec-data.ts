import "server-only";

export const secHeaders = () => ({
  "User-Agent":
    process.env.SEC_USER_AGENT ||
    "Stockwatcher research contact research@denizlg24.com",
});

const MIN_GAP_MS = 125;
const TICKER_TTL_MS = 86_400_000;

const gate = globalThis as typeof globalThis & { secNextSlot?: number };

/** One process-wide limiter (8 requests per second) for every sec.gov, data.sec.gov and efts.sec.gov request. */
export async function takeSlot() {
  const now = Date.now();
  const slot = Math.max(now, gate.secNextSlot ?? 0);
  gate.secNextSlot = slot + MIN_GAP_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

export async function secFetch(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
) {
  await takeSlot();
  const response = await fetch(url, {
    headers: secHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  });
  if (!response.ok)
    throw new Error(`SEC EDGAR returned HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length"));
  if (options.maxBytes && length > options.maxBytes)
    throw new Error("The SEC document is too large to process.");
  return response;
}

type TickerRow = { cik_str: number; ticker: string; title: string };

let tickers: { at: number; byTicker: Map<string, TickerRow> } | null = null;
let pending: Promise<Map<string, TickerRow>> | null = null;

async function tickerMap() {
  if (tickers && Date.now() - tickers.at < TICKER_TTL_MS)
    return tickers.byTicker;
  pending ??= (async () => {
    const response = await secFetch(
      "https://www.sec.gov/files/company_tickers.json",
    );
    const rows: Record<string, TickerRow> = await response.json();
    const byTicker = new Map<string, TickerRow>();
    for (const row of Object.values(rows))
      byTicker.set(row.ticker.toUpperCase(), row);
    tickers = { at: Date.now(), byTicker };
    return byTicker;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function lookupCik(symbol: string) {
  const row = (await tickerMap()).get(symbol.toUpperCase());
  return row ? { cik: String(row.cik_str), name: row.title } : null;
}

export type FactEntry = {
  val: number;
  end: string;
  start?: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  accn: string;
};

export type CompanyFacts = {
  entityName: string;
  facts: Record<
    string,
    Record<string, { units: Record<string, FactEntry[]> }>
  >;
};

export async function fetchCompanyFacts(cik: string): Promise<CompanyFacts> {
  const response = await secFetch(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`,
    { timeoutMs: 30_000, maxBytes: 60_000_000 },
  );
  return response.json();
}
