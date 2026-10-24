import "server-only";

import type {
  GridMeta,
  GridQuery,
  GridTitle,
  GridWindow,
  MapHighlight,
} from "@repo/schemas/stream";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  type ProfileRow,
  progress,
  recommendations,
  titles,
  watchlist,
} from "@/db/schema";
import { type AudienceRules, rulesKey } from "@/lib/audience-rules";
import { audienceFilter } from "@/lib/catalog";
import {
  cellAt,
  type Lattice,
  latticeRegions,
  layLattice,
  wrap,
} from "@/lib/grid-layout";
import { audienceKey } from "@/lib/recommendations";
import { GENRE_ANCHORS } from "@/lib/taste-space";

/** Enough to feel endless before it repeats, small enough to lay out in a blink. */
const GRID_TITLES = 12_000;
const TTL_MS = 60 * 60 * 1000;

type GridEntry = GridTitle & { x: number; y: number };
type Kind = "movie" | "series" | "all";

const lattices = new Map<
  string,
  { builtAt: number; lattice: Lattice<GridEntry>; index: Map<string, number> }
>();

async function build(rules: AudienceRules, kind: Kind) {
  const rows = await db
    .select({
      id: titles.id,
      title: titles.title,
      type: titles.type,
      year: titles.startYear,
      rating: titles.rating,
      posterPath: titles.posterPath,
      x: titles.mapX,
      y: titles.mapY,
    })
    .from(titles)
    .where(
      sql`${audienceFilter(rules)} ${
        kind === "movie"
          ? sql`and ${titles.type} = 'movie'`
          : kind === "series"
            ? sql`and ${titles.type} <> 'movie'`
            : sql``
      }`,
    )
    .orderBy(sql`${titles.posterPath} is null`, desc(titles.popularity))
    .limit(GRID_TITLES);
  const lattice = layLattice(rows);
  const index = new Map(lattice.cells.map((cell, i) => [cell.id, i]));
  return { builtAt: Date.now(), lattice, index };
}

/** One lattice per audience kind, rebuilt hourly; ingest changes it daily at most. */
async function latticeFor(rules: AudienceRules, kind: Kind) {
  const key = `${rulesKey(rules)}:${kind}`;
  const cached = lattices.get(key);
  if (cached && Date.now() - cached.builtAt < TTL_MS) return cached;
  const fresh = await build(rules, kind);
  lattices.set(key, fresh);
  return fresh;
}

function strip({ x: _x, y: _y, ...title }: GridEntry): GridTitle {
  return title;
}

export async function gridWindow(
  query: GridQuery,
  rules: AudienceRules,
): Promise<GridWindow> {
  const { lattice } = await latticeFor(rules, query.type ?? "all");
  if (lattice.cells.length === 0) return { cells: [] };
  const cells: GridWindow["cells"] = [];
  for (let gy = query.y0; gy <= query.y1; gy++) {
    for (let gx = query.x0; gx <= query.x1; gx++) {
      const cell = cellAt(lattice, gx, gy);
      if (cell) cells.push({ gx, gy, title: strip(cell) });
    }
  }
  return { cells };
}

export async function gridMeta(
  rules: AudienceRules,
  kind: Kind,
  profiles: ProfileRow[],
  focusId: string | null = null,
): Promise<GridMeta> {
  const { lattice, index } = await latticeFor(rules, kind);
  const focused = focusId ? index.get(focusId) : undefined;
  const latest =
    focused === undefined && profiles.length > 0
      ? await db
          .select({ id: progress.titleId })
          .from(progress)
          .where(
            inArray(
              progress.profileId,
              profiles.map((profile) => profile.id),
            ),
          )
          .orderBy(desc(progress.updatedAt))
          .limit(10)
      : [];
  const anchorIndex =
    focused ??
    latest.map((row) => index.get(row.id)).find((i) => i !== undefined) ??
    0;
  const anchors = Object.entries(GENRE_ANCHORS).map(([genre, [x, y]]) => ({
    genre,
    x,
    y,
  }));
  return {
    width: lattice.width,
    height: Math.max(1, lattice.height),
    regions: latticeRegions(lattice, anchors),
    start: {
      gx: wrap(anchorIndex, lattice.width),
      gy: Math.floor(anchorIndex / Math.max(1, lattice.width)),
    },
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
