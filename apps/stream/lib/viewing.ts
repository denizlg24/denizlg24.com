import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { findTitle } from "./catalog";

export async function validViewing(input: {
  titleId: string;
  episodeId: string | null;
}): Promise<boolean> {
  const title = await findTitle(input.titleId);
  if (!title) return false;
  if (title.type === "movie") return input.episodeId === null;
  if (!input.episodeId) return false;
  const episode = await db.query.episodes.findFirst({
    where: and(
      eq(episodes.id, input.episodeId),
      eq(episodes.seriesId, input.titleId),
    ),
  });
  return Boolean(
    episode &&
      episode.season !== null &&
      episode.season >= 0 &&
      episode.episode !== null &&
      episode.episode > 0,
  );
}
