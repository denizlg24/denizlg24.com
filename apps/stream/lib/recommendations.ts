import "server-only";

import { createMachineTokenSource } from "@denizlg24/auth/server";
import {
  type Recommendation,
  type RecommendationCandidate,
  type RecommendationRequest,
  recommendationResponseSchema,
} from "@repo/schemas/stream";
import { and, desc, eq, gte, like, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  type ProfileRow,
  progress,
  recommendations,
  type TitleRow,
  titles,
  watchlist,
} from "@/db/schema";
import { audienceFilter, serializeSummary } from "@/lib/catalog";
import { authIssuer, webUrl } from "@/lib/config";

const TTL_MS = 12 * 60 * 60 * 1000;
const POOL = 120;
const PICKS = 24;

type Signal = RecommendationRequest["history"][number]["signal"];
const SIGNAL_WEIGHT: Record<Signal, number> = {
  finished: 3,
  watching: 2,
  watchlist: 1.5,
  abandoned: -1,
};

let tokens: ReturnType<typeof createMachineTokenSource> | null = null;

function webTokens() {
  const clientId = process.env.STREAM_WEB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.STREAM_WEB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  tokens ??= createMachineTokenSource({
    issuer: authIssuer(),
    clientId,
    clientSecret,
    resource: webUrl(),
    scope: "superuser",
  });
  return tokens;
}

export function audienceKey(profiles: readonly ProfileRow[]): string {
  return profiles
    .map((profile) => profile.id)
    .sort()
    .join(",");
}

function candidate(row: TitleRow): RecommendationCandidate {
  return {
    id: row.id,
    title: row.title,
    year: row.startYear,
    type: row.type,
    genres: row.genres,
    rating: row.rating,
  };
}

/** Genre weights from what the audience watched, finished, saved or picked. */
export function genreAffinity(
  favorites: string[],
  signals: { genres: string[]; weight: number }[],
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const genre of favorites)
    weights.set(genre, (weights.get(genre) ?? 0) + 3);
  for (const { genres, weight } of signals) {
    for (const genre of genres) {
      weights.set(genre, (weights.get(genre) ?? 0) + weight);
    }
  }
  return weights;
}

export function signalOf(row: {
  completed: boolean;
  positionS: number;
  durationS: number;
  updatedAt: Date;
}): Signal {
  if (row.completed) return "finished";
  const stale = Date.now() - row.updatedAt.getTime() > 14 * 86_400_000;
  const barely = row.durationS > 0 && row.positionS / row.durationS < 0.15;
  return stale && barely ? "abandoned" : "watching";
}

async function profileHistory(
  profile: ProfileRow,
): Promise<RecommendationRequest["history"]> {
  const [watched, saved] = await Promise.all([
    db
      .select({ title: titles, progress })
      .from(progress)
      .innerJoin(titles, eq(titles.id, progress.titleId))
      .where(eq(progress.profileId, profile.id))
      .orderBy(desc(progress.updatedAt))
      .limit(50),
    db
      .select({ title: titles })
      .from(watchlist)
      .innerJoin(titles, eq(titles.id, watchlist.titleId))
      .where(eq(watchlist.profileId, profile.id))
      .orderBy(desc(watchlist.addedAt))
      .limit(30),
  ]);
  return [
    ...watched.map(({ title, progress: row }) => ({
      ...candidate(title),
      who: profile.name,
      signal: signalOf(row),
    })),
    ...saved.map(({ title }) => ({
      ...candidate(title),
      who: profile.name,
      signal: "watchlist" as const,
    })),
  ];
}

async function candidatePool(
  kids: boolean,
  affinity: Map<string, number>,
  seen: string[],
): Promise<TitleRow[]> {
  const top = [...affinity.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre]) => genre);
  const score =
    top.length > 0
      ? sql`(select count(*) from unnest(${titles.genres}) g where g = any(${sql.param(top)}::text[]))`
      : sql`0`;
  return db
    .select()
    .from(titles)
    .where(
      and(
        audienceFilter(kids),
        gte(titles.rating, 6.5),
        gte(titles.votes, 5000),
        seen.length > 0 ? notInArray(titles.id, seen) : undefined,
      ),
    )
    .orderBy(sql`${score} * 2 + ${titles.popularity} desc`)
    .limit(POOL);
}

async function askWeb(
  body: RecommendationRequest,
): Promise<{ id: string; reason: string }[] | null> {
  const source = webTokens();
  if (!source) return null;
  try {
    const response = await fetch(
      `${webUrl()}/api/admin/stream/recommendations`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await source.getToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      },
    );
    if (response.status === 401) source.invalidate();
    if (!response.ok) return null;
    return recommendationResponseSchema.parse(await response.json()).picks;
  } catch (error) {
    console.error("[stream] recommendations request failed", error);
    return null;
  }
}

function fallbackReason(
  row: TitleRow,
  affinity: Map<string, number>,
  group: boolean,
): string {
  const genre = row.genres
    .filter((name) => (affinity.get(name) ?? 0) > 0)
    .sort((a, b) => (affinity.get(b) ?? 0) - (affinity.get(a) ?? 0))[0];
  if (genre) {
    return group
      ? `Something ${genre.toLowerCase()} you'll all enjoy`
      : `Because you enjoy ${genre.toLowerCase()}`;
  }
  return row.rating && row.rating >= 8
    ? "One of the best-rated picks right now"
    : "Popular with viewers right now";
}

async function generate(profiles: ProfileRow[]): Promise<void> {
  const histories = await Promise.all(profiles.map(profileHistory));
  const history = histories.flat();
  const affinity = genreAffinity(
    profiles.flatMap((profile) => profile.favoriteGenres),
    history.map((item) => ({
      genres: item.genres,
      weight: SIGNAL_WEIGHT[item.signal],
    })),
  );
  const kids = profiles.some((profile) => profile.kids);
  const seen = [...new Set(history.map((item) => item.id))];
  const pool = await candidatePool(kids, affinity, seen);
  if (pool.length === 0) return;
  const picks = await askWeb({
    audience: profiles.map((profile) => ({
      name: profile.name,
      kids: profile.kids,
      favoriteGenres: profile.favoriteGenres,
    })),
    history: history.slice(0, 120),
    candidates: pool.map(candidate),
    count: PICKS,
  });
  const allowed = new Set(pool.map((row) => row.id));
  const chosen = (picks ?? []).filter((pick) => allowed.has(pick.id));
  const final =
    chosen.length > 0
      ? chosen
      : pool.slice(0, PICKS).map((row) => ({
          id: row.id,
          reason: fallbackReason(row, affinity, profiles.length > 1),
        }));
  const audience = audienceKey(profiles);
  await db.transaction(async (tx) => {
    await tx
      .delete(recommendations)
      .where(eq(recommendations.audience, audience));
    await tx.insert(recommendations).values(
      final.map((pick, rank) => ({
        audience,
        titleId: pick.id,
        rank,
        reason: pick.reason,
        source: chosen.length > 0 ? "llm" : "affinity",
      })),
    );
  });
}

async function stored(audience: string) {
  return db
    .select({ title: titles, rec: recommendations })
    .from(recommendations)
    .innerJoin(titles, eq(titles.id, recommendations.titleId))
    .where(eq(recommendations.audience, audience))
    .orderBy(recommendations.rank);
}

const inFlight = new Map<string, Promise<void>>();

/** Cached for 12 hours per audience; a stale set is served while a fresh one is made. */
export async function recommendationsFor(
  profiles: ProfileRow[],
): Promise<Recommendation[]> {
  if (profiles.length === 0) return [];
  const audience = audienceKey(profiles);
  let rows = await stored(audience);
  const fresh =
    rows.length > 0 && Date.now() - rows[0].rec.generatedAt.getTime() < TTL_MS;
  if (!fresh && !inFlight.has(audience)) {
    const job = generate(profiles)
      .catch((error) => console.error("[stream] recommendations failed", error))
      .finally(() => inFlight.delete(audience));
    inFlight.set(audience, job);
    if (rows.length === 0) {
      await job;
      rows = await stored(audience);
    }
  }
  return rows.map(({ title, rec }) => ({
    title: serializeSummary(title),
    reason: rec.reason,
  }));
}

/** Every audience a profile belongs to goes stale, solo and group alike. */
export async function invalidateRecommendations(
  profileId: string,
): Promise<void> {
  await db
    .update(recommendations)
    .set({ generatedAt: new Date(0) })
    .where(like(recommendations.audience, `%${profileId}%`));
}

export async function forgetProfileRecommendations(
  profileId: string,
): Promise<void> {
  await db
    .delete(recommendations)
    .where(like(recommendations.audience, `%${profileId}%`));
}
