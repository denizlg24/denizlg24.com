import type { SQL } from "bun";
import type { Collector } from "./collector";
import { loadPlayApps, type PlayApp } from "./play-apps";
import {
  archiveLog,
  at,
  BROWSER_USER_AGENT,
  errorMessage,
  jitter,
  sleep,
} from "./util";

export interface PlayListing {
  rating: number | null;
  ratingsCount: number | null;
  installs: string | null;
  updated: string | null;
  version: string | null;
}

const LD_JSON =
  /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const INSTALLS =
  />\s*([\d.,]+\s*[KMBkmb]?\+)\s*<\/div>\s*<div[^>]*>\s*Downloads\s*</;
const UPDATED = /Updated on<\/div>\s*<div[^>]*>\s*([^<]+?)\s*</;
const INIT_DATA =
  /AF_initDataCallback\(\{key: 'ds:\d+', hash: '[^']*', data:([\s\S]*?), sideChannel/g;

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function jsonLdRating(html: string): {
  rating: number | null;
  ratingsCount: number | null;
} {
  for (const match of html.matchAll(LD_JSON)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? "");
    } catch {
      continue;
    }
    if (at(parsed, "@type") !== "SoftwareApplication") continue;
    const rating = toNumber(at(parsed, "aggregateRating", "ratingValue"));
    const ratingsCount = toNumber(at(parsed, "aggregateRating", "ratingCount"));
    return {
      rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
      ratingsCount:
        ratingsCount !== null && ratingsCount >= 0
          ? Math.round(ratingsCount)
          : null,
    };
  }
  return { rating: null, ratingsCount: null };
}

function parseUpdated(text: string | undefined): string | null {
  if (!text) return null;
  const date = new Date(`${text} UTC`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function embeddedVersion(html: string): string | null {
  for (const match of html.matchAll(INIT_DATA)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1] ?? "");
    } catch {
      continue;
    }
    if (typeof at(data, 1, 2, 0, 0) !== "string") continue;
    const version = at(data, 1, 2, 140, 0, 0, 0);
    return typeof version === "string" && version.trim()
      ? version.trim()
      : null;
  }
  return null;
}

/** Fields that cannot be read are null: Play hides the version for apps that vary by device. */
export function parsePlayPage(html: string): PlayListing {
  const installs = INSTALLS.exec(html)?.[1]?.replace(/\s+/g, "") ?? null;
  return {
    ...jsonLdRating(html),
    installs,
    updated: parseUpdated(UPDATED.exec(html)?.[1]),
    version: embeddedVersion(html),
  };
}

async function fetchListing(packageId: string): Promise<PlayListing> {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}&hl=en&gl=US`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: "SOCS=CAI",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const listing = parsePlayPage(await response.text());
  if (listing.rating === null && listing.ratingsCount === null) {
    throw new Error("no rating on the page");
  }
  return listing;
}

const CHECK_INTERVAL_MS = 3 * 3_600_000;
const BETWEEN_PAGES_MS = 2_500;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function playCollector(
  sql: SQL,
  configured: string | undefined,
): Collector {
  const apps: PlayApp[] = loadPlayApps(configured);
  return {
    name: "play",
    intervalMs: () => CHECK_INTERVAL_MS,
    async run() {
      const day = utcDay(new Date());
      const done: { package: string }[] = await sql`
        SELECT package FROM archive_play WHERE day = ${day}`;
      const have = new Set(done.map((row) => row.package));
      let written = 0;
      const failures: string[] = [];
      for (const app of apps) {
        if (have.has(app.package)) continue;
        try {
          const listing = await fetchListing(app.package);
          await sql`
            INSERT INTO archive_play
              (day, ticker, package, rating, ratings_count, installs, updated, version)
            VALUES (
              ${day}, ${app.ticker}, ${app.package}, ${listing.rating},
              ${listing.ratingsCount}, ${listing.installs}, ${listing.updated},
              ${listing.version}
            )
            ON CONFLICT DO NOTHING`;
          written += 1;
        } catch (error) {
          failures.push(`${app.package}: ${errorMessage(error)}`);
        }
        await sleep(jitter(BETWEEN_PAGES_MS, 0.4));
      }
      if (failures.length > 0) {
        archiveLog(
          `play: ${failures.length} failed: ${failures.slice(0, 5).join("; ")}`,
        );
        if (written === 0 && have.size === 0) throw new Error(failures[0]);
      }
      return written;
    },
  };
}
