import type { SQL } from "bun";
import { z } from "zod";
import type { Collector } from "./collector";
import { fetchJson } from "./util";

const ENDPOINT =
  "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

/** CNN answers 418 to anything that does not look like a page on cnn.com. */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.cnn.com/markets/fear-and-greed",
  Origin: "https://www.cnn.com",
  Accept: "application/json",
};

const score = z.number().min(0).max(100);
const timestamp = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "number" ? value : Date.parse(value)))
  .pipe(z.number().positive());
const indicator = z.object({ score });

const responseSchema = z.object({
  fear_and_greed: z.object({
    score,
    timestamp,
    previous_close: score.nullish(),
  }),
  fear_and_greed_historical: z.object({
    data: z.array(
      z.object({
        x: z.number().positive(),
        y: score,
        rating: z.string().nullish(),
      }),
    ),
  }),
  market_momentum_sp500: indicator,
  stock_price_strength: indicator,
  stock_price_breadth: indicator,
  put_call_options: indicator,
  junk_bond_demand: indicator,
  market_volatility_vix: indicator,
  safe_haven_demand: indicator,
});

export interface FearGreedSnapshot {
  sourceTs: Date;
  score: number;
  previousClose: number | null;
  momentum: number;
  strength: number;
  breadth: number;
  putCall: number;
  junkBond: number;
  volatility: number;
  safeHaven: number;
}

export interface FearGreedDaily {
  day: string;
  score: number;
  rating: string | null;
}

export function parseFearGreed(body: unknown): {
  snapshot: FearGreedSnapshot;
  daily: FearGreedDaily[];
} {
  const raw = responseSchema.parse(body);
  const daily = new Map<string, FearGreedDaily>();
  for (const point of raw.fear_and_greed_historical.data) {
    const day = new Date(point.x).toISOString().slice(0, 10);
    daily.set(day, { day, score: point.y, rating: point.rating ?? null });
  }
  return {
    snapshot: {
      sourceTs: new Date(raw.fear_and_greed.timestamp),
      score: raw.fear_and_greed.score,
      previousClose: raw.fear_and_greed.previous_close ?? null,
      momentum: raw.market_momentum_sp500.score,
      strength: raw.stock_price_strength.score,
      breadth: raw.stock_price_breadth.score,
      putCall: raw.put_call_options.score,
      junkBond: raw.junk_bond_demand.score,
      volatility: raw.market_volatility_vix.score,
      safeHaven: raw.safe_haven_demand.score,
    },
    daily: [...daily.values()],
  };
}

const NEW_YORK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** Regular session, 09:30-16:00 New York time on weekdays; holidays are not modelled. */
export function usMarketHours(now: Date): boolean {
  const parts = Object.fromEntries(
    NEW_YORK.formatToParts(now).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function fearGreedIntervalMs(now: Date): number {
  return usMarketHours(now) ? 15 * 60_000 : 3_600_000;
}

export function fearGreedCollector(sql: SQL): Collector {
  return {
    name: "feargreed",
    intervalMs: fearGreedIntervalMs,
    async run() {
      const { snapshot, daily } = parseFearGreed(
        await fetchJson(ENDPOINT, HEADERS),
      );
      let written = 0;

      const latest: { score: number; source_ts: Date }[] = await sql`
        SELECT score, source_ts FROM archive_fear_greed ORDER BY taken_at DESC LIMIT 1`;
      const previous = latest[0];
      const unchanged =
        previous !== undefined &&
        previous.score === snapshot.score &&
        previous.source_ts.getTime() === snapshot.sourceTs.getTime();
      if (!unchanged) {
        await sql`
          INSERT INTO archive_fear_greed
            (taken_at, source_ts, score, previous_close, momentum, strength, breadth,
             put_call, junk_bond, volatility, safe_haven)
          VALUES (
            ${new Date(Math.floor(Date.now() / 1000) * 1000)}, ${snapshot.sourceTs},
            ${snapshot.score}, ${snapshot.previousClose}, ${snapshot.momentum},
            ${snapshot.strength}, ${snapshot.breadth}, ${snapshot.putCall},
            ${snapshot.junkBond}, ${snapshot.volatility}, ${snapshot.safeHaven}
          )
          ON CONFLICT DO NOTHING`;
        written += 1;
      }

      if (daily.length > 0) {
        await sql`
          INSERT INTO archive_fear_greed_daily ${sql(daily)}
          ON CONFLICT (day) DO UPDATE SET score = EXCLUDED.score, rating = EXCLUDED.rating`;
      }
      return written;
    },
  };
}
