import "server-only";
import type { ChartPoint, MarketSeries, Quote } from "./models";
import type { Range } from "./universes";

const board =
  "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR";
export const isMoex = (symbol: string) => symbol.endsWith(".ME");
type Block = { columns: string[]; data: (string | number | null)[][] };
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const localTime = (value: string) =>
  Date.parse(value.replace(" ", "T") + "+03:00") / 1000;
const rows = (block: Block | undefined) =>
  (block?.data ?? []).map((row) =>
    Object.fromEntries(block!.columns.map((name, index) => [name, row[index]])),
  );

async function iss(path: string, params: Record<string, string>) {
  const query = new URLSearchParams({
    "iss.meta": "off",
    lang: "en",
    ...params,
  });
  const response = await fetch(`${board}${path}?${query}`, {
    next: { revalidate: 120 },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok)
    throw new Error("Moscow Exchange data is temporarily unavailable.");
  return (await response.json()) as Record<string, Block>;
}

export async function moexQuotes(
  symbols: string[],
  since?: string,
): Promise<Quote[]> {
  if (!symbols.length) return [];
  const { securities, marketdata } = await iss("/securities.json", {
    securities: symbols.map((symbol) => symbol.slice(0, -3)).join(","),
    "iss.only": "securities,marketdata",
  });
  const requested = new Set(symbols);
  const metadata = new Map(rows(securities).map((row) => [row.SECID, row]));
  const quotes = rows(marketdata).flatMap((row) => {
    const symbol = `${row.SECID}.ME`;
    const info = metadata.get(row.SECID);
    const price = number(row.LAST);
    const time =
      typeof row.SYSTIME === "string" && typeof row.TIME === "string"
        ? localTime(`${row.SYSTIME.slice(0, 10)} ${row.TIME}`)
        : NaN;
    if (!requested.has(symbol) || price == null || !Number.isFinite(time))
      return [];
    const change = number(row.CHANGE);
    const previous = change != null ? price - change : number(info?.PREVPRICE);
    return [
      {
        symbol,
        name: String(info?.SECNAME ?? row.SECID),
        currency: "RUB",
        exchange: "Moscow Exchange",
        price,
        previous,
        change,
        percent: previous && change != null ? (change / previous) * 100 : null,
        time,
        open: number(row.OPEN),
        high: number(row.HIGH),
        low: number(row.LOW),
        volume: number(row.VOLTODAY),
        cap: number(row.ISSUECAPITALIZATION),
        yearHigh: null,
        yearLow: null,
      },
    ];
  });
  if (!since) return quotes;
  const till = new Date(Date.parse(since) + 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  const valuations: Quote[] = [];
  for (let i = 0; i < quotes.length; i += 4) {
    const batch = await Promise.all(
      quotes.slice(i, i + 4).map(async (quote) => {
        try {
          const path = `/securities/${encodeURIComponent(quote.symbol.slice(0, -3))}/candles.json`;
          const data = await iss(path, { from: since, till, interval: "24" });
          const first = number(rows(data.candles)[0]?.close);
          return {
            ...quote,
            periodPercent: first ? (quote.price / first - 1) * 100 : null,
          };
        } catch {
          return { ...quote, periodPercent: null };
        }
      }),
    );
    valuations.push(...batch);
  }
  return valuations;
}

export async function moexSeries(
  symbol: string,
  range: Range,
  since?: string,
): Promise<MarketSeries> {
  const now = new Date();
  const from = new Date(now);
  if (range === "YTD") from.setUTCMonth(0, 1);
  else {
    const days: Record<Exclude<Range, "YTD">, number> = {
      "1D": 1,
      "5D": 7,
      "1M": 30,
      "3M": 90,
      "6M": 185,
      "1Y": 365,
      "5Y": 1826,
    };
    from.setUTCDate(from.getUTCDate() - days[range]);
  }
  const start = since ?? from.toISOString().slice(0, 10);
  const length = (now.getTime() - Date.parse(start)) / 86_400_000;
  const interval = since
    ? length > 730
      ? "7"
      : "24"
    : range === "1D"
      ? "10"
      : range === "5D"
        ? "60"
        : range === "5Y"
          ? "7"
          : "24";
  const path = `/securities/${encodeURIComponent(symbol.slice(0, -3))}/candles.json`;
  const points: ChartPoint[] = [];
  const quote = moexQuotes([symbol])
    .then((items) => items[0] ?? null)
    .catch(() => null);
  for (let offset = 0; offset < 3000;) {
    const result = await iss(path, {
      from: start,
      interval,
      start: String(offset),
    });
    const page = rows(result.candles);
    for (const row of page) {
      const open = number(row.open),
        high = number(row.high),
        low = number(row.low),
        close = number(row.close);
      const time =
        typeof row.begin === "string"
          ? interval === "24" || interval === "7"
            ? Date.parse(row.begin.slice(0, 10) + "T12:00:00Z") / 1000
            : localTime(row.begin)
          : NaN;
      if (
        open != null &&
        high != null &&
        low != null &&
        close != null &&
        Number.isFinite(time)
      ) {
        points.push({
          time,
          open,
          high,
          low,
          close,
          volume: number(row.volume),
        });
      }
    }
    if (page.length < 500) break;
    offset += page.length;
  }
  return { quote: await quote, points, source: "Moscow Exchange" };
}
