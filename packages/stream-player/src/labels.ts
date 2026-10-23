import type { Episode } from "@repo/schemas/stream";

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function rateLabel(rate: number): string {
  return rate === 1 ? "Normal" : `${rate}×`;
}

export function languageName(code: string): string {
  if (!code) return "";
  try {
    return (
      new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

export function episodeCode(episode: Pick<Episode, "season" | "episode">) {
  const season = episode.season !== null ? `S${episode.season}` : "";
  const number = episode.episode !== null ? `E${episode.episode}` : "";
  return [season, number].filter(Boolean).join(" ");
}

export function episodeLabel(
  episode: Pick<Episode, "season" | "episode" | "title">,
): string {
  const code = episodeCode(episode);
  const title = episode.title?.trim() ?? "";
  if (code && title) return `${code} · ${title}`;
  return code || title || "Next episode";
}
