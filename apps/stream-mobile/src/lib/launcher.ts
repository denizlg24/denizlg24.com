import type { Browse } from "@repo/schemas/stream";

/** One entry of the TV home screen's "Continue watching" (`apps/tv-launcher`). */
export interface LauncherItem {
  title: string;
  subtitle: string | null;
  /** Opened inside Stream when the entry is chosen. */
  uri: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
}

/**
 * Home's Continue watching row as the launcher shows it. Null for every other
 * tab, which carry no such row and must not read as "nothing in progress".
 */
export function launcherItems(browse: Browse): LauncherItem[] | null {
  if (browse.tab !== "home") return null;
  return browse.rows.flatMap((row) =>
    row.kind === "continue"
      ? row.items.map(({ title, progress, episode }) => ({
          title: title.title,
          subtitle: episodeMark(episode?.season, episode?.episode),
          uri: watchUri(title.id, progress.episodeId),
          positionMs: Math.round(progress.positionS * 1000),
          durationMs: Math.round(progress.durationS * 1000),
          updatedAt: Date.parse(progress.updatedAt),
        }))
      : [],
  );
}

function episodeMark(
  season: number | null | undefined,
  episode: number | null | undefined,
): string | null {
  if (episode == null) return null;
  return season == null ? `E${episode}` : `S${season} E${episode}`;
}

function watchUri(id: string, episodeId: string | null): string {
  const path = `stream://tv/watch/${encodeURIComponent(id)}`;
  return episodeId ? `${path}?episode=${encodeURIComponent(episodeId)}` : path;
}
