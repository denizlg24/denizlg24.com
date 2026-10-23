import { get } from "node:https";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import type { TitleType } from "@repo/schemas/stream";

export const IMDB_DATASETS = "https://datasets.imdbws.com";

const TYPES: Record<string, TitleType> = {
  movie: "movie",
  tvSeries: "series",
  tvMiniSeries: "miniseries",
};

export function titleTypeOf(imdbType: string): TitleType | null {
  return TYPES[imdbType] ?? null;
}

export function field(value: string | undefined): string | null {
  return value === undefined || value === "\\N" || value === "" ? null : value;
}

export function intField(value: string | undefined): number | null {
  const text = field(value);
  if (text === null) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Votes say how many people care, recency says whether they care now. A
 * log keeps a 2M-vote classic from burying everything; the decay halves a
 * title's weight roughly every four years without ever reaching zero.
 */
export function popularityScore(
  votes: number,
  startYear: number | null,
  now = new Date().getUTCFullYear(),
): number {
  const reach = Math.log10(Math.max(votes, 1));
  const age = startYear === null ? 30 : Math.max(0, now - startYear);
  return reach * (0.35 + 0.65 * Math.exp(-age / 6));
}

/** Lines of a gzipped TSV, header skipped, without holding the file. */
export async function* tsvRows(body: Readable): AsyncGenerator<string[]> {
  const lines = createInterface({
    input: body.pipe(createGunzip()),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let header = true;
  for await (const line of lines) {
    if (header) header = false;
    else if (line.length > 0) yield line.split("\t");
  }
}

export function openDataset(name: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    get(`${IMDB_DATASETS}/${name}`, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${name}: HTTP ${response.statusCode}`));
        return;
      }
      resolve(response);
    }).on("error", reject);
  });
}
