import "server-only";

export type EarningsEvent = {
  date: string;
  symbol: string;
  name: string;
  time: "before" | "after" | "unknown";
  marketCap: number | null;
  epsForecast: number | null;
  estimates: number | null;
  lastYearEps: number | null;
  quarter: string | null;
};

type NasdaqRow = {
  symbol?: string;
  name?: string;
  time?: string;
  marketCap?: string;
  epsForecast?: string;
  noOfEsts?: string;
  lastYearEPS?: string;
  fiscalQuarterEnding?: string;
};

const money = (value: string | undefined) => {
  if (!value || value === "N/A") return null;
  const negative = /\(.*\)/.test(value) || value.trim().startsWith("-");
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed) || value.replace(/[^0-9.]/g, "") === "") return null;
  return negative ? -parsed : parsed;
};

async function earningsOn(date: string): Promise<EarningsEvent[]> {
  const response = await fetch(
    `https://api.nasdaq.com/api/calendar/earnings?date=${date}`,
    {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error("Earnings calendar is unavailable.");
  const body = (await response.json()) as { data?: { rows?: NasdaqRow[] | null } | null };
  return (body.data?.rows ?? []).flatMap((row): EarningsEvent[] =>
    row.symbol
      ? [
          {
            date,
            symbol: row.symbol.trim().toUpperCase().replace("/", "-"),
            name: row.name?.trim() ?? row.symbol,
            time:
              row.time === "time-pre-market"
                ? "before"
                : row.time === "time-after-hours"
                  ? "after"
                  : "unknown",
            marketCap: money(row.marketCap),
            epsForecast: money(row.epsForecast),
            estimates: money(row.noOfEsts),
            lastYearEps: money(row.lastYearEPS),
            quarter: row.fiscalQuarterEnding ?? null,
          },
        ]
      : [],
  );
}

/** US earnings for each weekday in [from, from + days), from Nasdaq. */
export async function earningsCalendar(from: string, days: number) {
  const start = new Date(`${from}T12:00:00Z`);
  const dates: string[] = [];
  for (let i = 0; dates.length < days && i < days * 2; i++) {
    const day = new Date(start.getTime() + i * 86400000);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
      dates.push(day.toISOString().slice(0, 10));
  }
  const results = await Promise.allSettled(dates.map(earningsOn));
  return {
    dates,
    events: results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
    failed: dates.filter((_, i) => results[i].status === "rejected"),
  };
}

/** FOMC meetings as published by the Federal Reserve (decision on day two). */
export const fomcMeetings = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
];
