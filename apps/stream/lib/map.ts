import "server-only";

import {
  MAP_SIZE,
  type MapHighlight,
  type MapMeta,
  type MapQuery,
  type MapRegion,
} from "@repo/schemas/stream";
import { and, between, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  type ProfileRow,
  progress,
  recommendations,
  titles,
  watchlist,
} from "@/db/schema";
import { audienceFilter } from "@/lib/catalog";
import { audienceKey } from "@/lib/recommendations";
import { GENRE_ANCHORS, reach } from "@/lib/taste-space";

const MAX_POINTS = 1500;

export function mapMeta(): MapMeta {
  return {
    size: MAP_SIZE,
    anchors: Object.entries(GENRE_ANCHORS).map(([genre, [x, y]]) => ({
      genre,
      x,
      y,
    })),
  };
}

/** One title per `cell`-sized square — the most popular — so a zoomed-out view stays legible. */
export async function mapRegion(
  query: MapQuery,
  kids: boolean,
): Promise<MapRegion> {
  const cellX = sql`floor(${titles.mapX} / ${query.cell})`;
  const cellY = sql`floor(${titles.mapY} / ${query.cell})`;
  const rows = await db
    .selectDistinctOn([cellX, cellY], {
      id: titles.id,
      x: titles.mapX,
      y: titles.mapY,
      title: titles.title,
      type: titles.type,
      year: titles.startYear,
      rating: titles.rating,
      posterPath: titles.posterPath,
      votes: titles.votes,
    })
    .from(titles)
    .where(
      and(
        audienceFilter(kids),
        between(
          titles.mapX,
          Math.min(query.x0, query.x1),
          Math.max(query.x0, query.x1),
        ),
        between(
          titles.mapY,
          Math.min(query.y0, query.y1),
          Math.max(query.y0, query.y1),
        ),
        query.type ? eq(titles.type, query.type) : undefined,
      ),
    )
    .orderBy(cellX, cellY, desc(titles.popularity))
    .limit(MAX_POINTS);
  return {
    points: rows.map(({ votes, ...row }) => ({ ...row, weight: reach(votes) })),
  };
}

export async function mapHighlights(
  profiles: ProfileRow[],
): Promise<MapHighlight[]> {
  const ids = profiles.map((profile) => profile.id);
  const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const point = {
    id: titles.id,
    x: titles.mapX,
    y: titles.mapY,
    title: titles.title,
  };
  const [watched, saved, picked] = await Promise.all([
    db
      .select({ ...point, profileId: progress.profileId })
      .from(progress)
      .innerJoin(titles, eq(titles.id, progress.titleId))
      .where(inArray(progress.profileId, ids))
      .orderBy(desc(progress.updatedAt))
      .limit(200),
    db
      .select({ ...point, profileId: watchlist.profileId })
      .from(watchlist)
      .innerJoin(titles, eq(titles.id, watchlist.titleId))
      .where(inArray(watchlist.profileId, ids))
      .limit(200),
    db
      .select(point)
      .from(recommendations)
      .innerJoin(titles, eq(titles.id, recommendations.titleId))
      .where(eq(recommendations.audience, audienceKey(profiles)))
      .orderBy(recommendations.rank),
  ]);
  const byId = new Map<string, MapHighlight>();
  const add = (
    row: { id: string; x: number; y: number; title: string },
    kind: MapHighlight["kind"],
    who: string | null,
  ) => {
    const existing = byId.get(row.id);
    if (existing) {
      if (who && !existing.who.includes(who)) existing.who.push(who);
      return;
    }
    byId.set(row.id, { ...row, kind, who: who ? [who] : [] });
  };
  for (const row of watched)
    add(row, "watched", names.get(row.profileId) ?? null);
  for (const row of saved) add(row, "saved", names.get(row.profileId) ?? null);
  for (const row of picked) add(row, "picked", null);
  return [...byId.values()];
}
