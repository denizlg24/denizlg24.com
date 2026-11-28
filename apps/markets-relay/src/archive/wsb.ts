import type { SQL } from "bun";
import { z } from "zod";
import type { Collector } from "./collector";
import { errorMessage, fetchJson } from "./util";

export const APEWISDOM_FILTERS = ["wallstreetbets", "all-stocks"] as const;
export type ApeWisdomFilter = (typeof APEWISDOM_FILTERS)[number];

const count = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().finite());

const responseSchema = z.object({
  results: z.array(
    z.object({
      rank: count,
      ticker: z.string().trim().min(1),
      mentions: count,
      upvotes: count,
      rank_24h_ago: count.nullish(),
      mentions_24h_ago: count.nullish(),
    }),
  ),
});

export interface WsbRow {
  filter: ApeWisdomFilter;
  ticker: string;
  rank: number;
  mentions: number;
  upvotes: number;
  rank24hAgo: number | null;
  mentions24hAgo: number | null;
}

export function parseApeWisdom(
  body: unknown,
  filter: ApeWisdomFilter,
): WsbRow[] {
  const parsed = responseSchema.parse(body);
  return parsed.results.map((item) => ({
    filter,
    ticker: item.ticker.toUpperCase(),
    rank: item.rank,
    mentions: item.mentions,
    upvotes: item.upvotes,
    rank24hAgo: item.rank_24h_ago ?? null,
    mentions24hAgo: item.mentions_24h_ago ?? null,
  }));
}

const INTERVAL_MS = 15 * 60_000;

export function wsbCollector(sql: SQL): Collector {
  return {
    name: "wsb",
    intervalMs: () => INTERVAL_MS,
    async run() {
      const takenAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      let written = 0;
      const failures: string[] = [];
      for (const filter of APEWISDOM_FILTERS) {
        try {
          const body = await fetchJson(
            `https://apewisdom.io/api/v1.0/filter/${filter}/page/1`,
            {
              Accept: "application/json",
              "User-Agent": "markets-relay-archive",
            },
          );
          const rows = parseApeWisdom(body, filter).map((row) => ({
            taken_at: takenAt,
            filter: row.filter,
            ticker: row.ticker,
            rank: row.rank,
            mentions: row.mentions,
            upvotes: row.upvotes,
            rank_24h_ago: row.rank24hAgo,
            mentions_24h_ago: row.mentions24hAgo,
          }));
          if (rows.length === 0) continue;
          await sql`INSERT INTO archive_wsb ${sql(rows)} ON CONFLICT DO NOTHING`;
          written += rows.length;
        } catch (error) {
          failures.push(`${filter}: ${errorMessage(error)}`);
        }
      }
      if (failures.length > 0) throw new Error(failures.join("; "));
      return written;
    },
  };
}
