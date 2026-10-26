import "server-only";

import type { Subtitles } from "@repo/schemas/stream";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { episodes, type TitleRow } from "@/db/schema";
import { streamBaseUrl } from "@/lib/config";
import { resultSchema, toTracks } from "@/lib/subtitle-files";

const SEARCH = "https://sub.wyzie.io/search";

export class EpisodeNotFoundError extends Error {}

export function subtitlesOffUrl(): string {
  return `${streamBaseUrl()}/api/public/subtitles/off`;
}

async function episodeNumbers(
  title: TitleRow,
  episodeId: string | null,
): Promise<{ season: number; episode: number } | null> {
  if (title.type === "movie") return null;
  if (!episodeId) throw new EpisodeNotFoundError();
  const row = await db.query.episodes.findFirst({
    where: and(eq(episodes.id, episodeId), eq(episodes.seriesId, title.id)),
  });
  if (!row || row.season === null || row.episode === null)
    throw new EpisodeNotFoundError();
  return { season: row.season, episode: row.episode };
}

/**
 * Wyzie Subs (OpenSubtitles, SubDL, Podnapisi) by IMDb id. Searches are
 * cached for six hours, so a family re-opening the same episode costs one
 * request of the free key's thousand a day; each file is cached the same way.
 */
export async function subtitlesFor(
  title: TitleRow,
  episodeId: string | null,
): Promise<Subtitles> {
  const key = process.env.STREAM_WYZIE_KEY;
  const off = subtitlesOffUrl();
  const numbers = await episodeNumbers(title, episodeId);
  if (!key) return { configured: false, off, tracks: [] };
  const search = new URL(SEARCH);
  search.searchParams.set("id", title.id);
  if (numbers) {
    search.searchParams.set("season", String(numbers.season));
    search.searchParams.set("episode", String(numbers.episode));
  }
  search.searchParams.set("format", "srt");
  search.searchParams.set("key", key);
  try {
    const response = await fetch(search, {
      headers: { accept: "application/json" },
      next: { revalidate: 6 * 3600 },
      signal: AbortSignal.timeout(8000),
    });
    // 400 is how Wyzie says it found nothing.
    if (!response.ok) return { configured: true, off, tracks: [] };
    const parsed = resultSchema.safeParse(await response.json());
    if (!parsed.success) return { configured: true, off, tracks: [] };
    const tracks = toTracks(parsed.data, streamBaseUrl());
    return { configured: true, off, tracks };
  } catch {
    return { configured: true, off, tracks: [] };
  }
}
