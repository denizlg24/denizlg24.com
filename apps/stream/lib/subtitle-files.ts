import type { SubtitleTrack } from "@repo/schemas/stream";
import { z } from "zod";

const DOWNLOAD_HOST = "sub.wyzie.io";
/** Per language: enough to pick another release when one is out of sync. */
const PER_LANGUAGE = 3;

export const resultSchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    url: z.url(),
    format: z.string().nullish(),
    display: z.string().nullish(),
    language: z.string().nullish(),
    isHearingImpaired: z.boolean().nullish(),
    release: z.string().nullish(),
    downloadCount: z.number().nullish(),
    ai: z.boolean().nullish(),
  }),
);
export type Result = z.infer<typeof resultSchema>[number];

/** The file route serves Wyzie downloads only, so it is no open proxy. */
export function encodeSubtitleToken(url: string): string {
  return Buffer.from(url).toString("base64url");
}

export function decodeSubtitleToken(token: string): string | null {
  try {
    const url = new URL(Buffer.from(token, "base64url").toString("utf8"));
    if (url.protocol !== "https:" || url.hostname !== DOWNLOAD_HOST)
      return null;
    if (!url.pathname.startsWith("/c/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Best first: human subtitles over AI ones, plain over hearing-impaired, most downloaded. */
export function rankSubtitles(results: Result[]): Result[] {
  const score = (item: Result) =>
    (item.ai ? 2 : 0) + (item.isHearingImpaired ? 1 : 0);
  const sorted = results
    .filter((item) => item.language && /^[a-z]{2}$/.test(item.language))
    .sort(
      (a, b) =>
        score(a) - score(b) || (b.downloadCount ?? 0) - (a.downloadCount ?? 0),
    );
  const kept = new Map<string, number>();
  return sorted.filter((item) => {
    const language = item.language as string;
    const count = kept.get(language) ?? 0;
    kept.set(language, count + 1);
    return count < PER_LANGUAGE;
  });
}

/**
 * SRT to WebVTT: a header and dotted milliseconds; the cues are otherwise
 * the same. The free plan opens every file with a cue advertising Wyzie,
 * which is dropped.
 */
export function toWebVtt(text: string): string {
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .filter((block) => !/store\.wyzie\.io/i.test(block));
  if (blocks[0]?.startsWith("WEBVTT")) return `${blocks.join("\n\n")}\n`;
  return `WEBVTT\n\n${blocks
    .join("\n\n")
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}\n`;
}

export function subtitleLabel(item: Result, ordinal: number): string {
  const name = item.display || (item.language as string).toUpperCase();
  const parts = [name];
  if (item.isHearingImpaired) parts.push("for the hard of hearing");
  if (ordinal > 0) parts.push(`version ${ordinal + 1}`);
  return parts.join(", ");
}

/** Wyzie's results as this app's tracks, the file served through `base`. */
export function toTracks(results: Result[], base: string): SubtitleTrack[] {
  const seen = new Map<string, number>();
  return (
    rankSubtitles(results)
      .filter((item) => decodeSubtitleToken(encodeSubtitleToken(item.url)))
      .map((item) => {
        const language = item.language as string;
        const name = item.display || language.toUpperCase();
        // Numbered by the name shown: one code can carry two names
        // ("Portuguese", "Brazilian"), which read as a gap in the versions.
        const ordinal = seen.get(name) ?? 0;
        seen.set(name, ordinal + 1);
        return {
          name,
          track: {
            id: item.id,
            url: `${base}/api/public/subtitles/${encodeSubtitleToken(item.url)}`,
            language,
            label: subtitleLabel(item, ordinal),
            hearingImpaired: item.isHearingImpaired ?? false,
            release: item.release ?? null,
          },
        };
      })
      // Alphabetical by language for the picker; the ranking holds within one.
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ track }) => track)
  );
}
