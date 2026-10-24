import "server-only";

import {
  type AssistantIntent,
  type AssistantResult,
  assistantIntentResponseSchema,
  type Recommendation,
} from "@repo/schemas/stream";
import {
  and,
  arrayOverlaps,
  desc,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  not,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { type ProfileRow, type TitleRow, titles } from "@/db/schema";
import { fallbackIntent } from "@/lib/assistant-intent";
import { audienceFilter, nearbyTitles, serializeSummary } from "@/lib/catalog";
import {
  askWeb,
  audienceKey,
  candidate,
  profileHistory,
} from "@/lib/recommendations";
import { postToWeb } from "@/lib/web";

const POOL = 120;
const PICKS = 24;
const STRICT_MINIMUM = 30;
const CACHE_MS = 30 * 60 * 1000;
const CACHE_ENTRIES = 50;
const OVERVIEW_CHARS = 220;

async function readIntent(
  prompt: string,
  kids: boolean,
): Promise<AssistantIntent> {
  const response = await postToWeb(
    "/api/admin/stream/assistant",
    { prompt, kids, year: new Date().getUTCFullYear() },
    assistantIntentResponseSchema,
    25_000,
  );
  return response?.intent ?? fallbackIntent(prompt);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Hard filters; `strict` false keeps only what must never be broken. */
export function intentFilters(
  intent: AssistantIntent,
  kids: boolean,
  strict: boolean,
): SQL[] {
  const filters: (SQL | undefined)[] = [
    audienceFilter(kids),
    isNotNull(titles.posterPath),
    gte(titles.votes, 1000),
    intent.type === "movie"
      ? inArray(titles.type, ["movie"])
      : intent.type
        ? inArray(titles.type, ["series", "miniseries"])
        : undefined,
    intent.excludeGenres.length > 0
      ? not(arrayOverlaps(titles.genres, intent.excludeGenres))
      : undefined,
  ];
  if (strict) {
    filters.push(
      intent.genres.length > 0
        ? arrayOverlaps(titles.genres, intent.genres)
        : undefined,
      intent.yearFrom ? gte(titles.startYear, intent.yearFrom) : undefined,
      intent.yearTo ? lte(titles.startYear, intent.yearTo) : undefined,
      intent.runtimeMax
        ? lte(titles.runtimeMinutes, intent.runtimeMax)
        : undefined,
      intent.ratingMin ? gte(titles.rating, intent.ratingMin) : undefined,
      intent.mood === "light"
        ? lte(titles.mood, -0.15)
        : intent.mood === "heavy"
          ? gte(titles.mood, 0.15)
          : undefined,
      intent.languages.length > 0
        ? inArray(titles.originalLanguage, intent.languages)
        : undefined,
    );
  }
  return filters.filter((filter): filter is SQL => filter !== undefined);
}

function relevance(intent: AssistantIntent): SQL {
  const keywordHits =
    intent.keywords.length > 0
      ? sql.join(
          intent.keywords.map(
            (word) =>
              sql`(case when concat_ws(' ', ${titles.title}, ${titles.tagline}, ${titles.overview}) ilike ${`%${escapeLike(word)}%`} then 1 else 0 end)`,
          ),
          sql` + `,
        )
      : sql`0`;
  const genreHits =
    intent.genres.length > 0
      ? sql`(select count(*) from unnest(${titles.genres}) g where g = any(${sql.param(intent.genres)}::text[]))`
      : sql`0`;
  return sql`(${keywordHits}) * 40 + ${genreHits} * 10 + ln(1 + ${titles.votes}) * 3 + coalesce(${titles.rating}, 0) * 2`;
}

async function similarTitles(
  names: string[],
  kids: boolean,
): Promise<TitleRow[]> {
  const anchors = await Promise.all(
    names.map(async (name) => {
      const [row] = await db
        .select()
        .from(titles)
        .where(
          and(
            audienceFilter(kids),
            ilike(titles.title, `%${escapeLike(name)}%`),
          ),
        )
        .orderBy(desc(titles.votes))
        .limit(1);
      return row;
    }),
  );
  const near = await Promise.all(
    anchors
      .filter((row): row is TitleRow => row !== undefined)
      .map(async (row) => ({ row, near: await nearbyTitles(row, kids, 15) })),
  );
  const ids = near.flatMap(({ near: list }) => list.map((item) => item.id));
  if (ids.length === 0) return [];
  // The anchors themselves are what they named, not what they want next.
  const exclude = near.map(({ row }) => row.id);
  return db
    .select()
    .from(titles)
    .where(and(inArray(titles.id, ids), notInArray(titles.id, exclude)));
}

export async function assistantPool(
  intent: AssistantIntent,
  kids: boolean,
  finished: string[],
): Promise<TitleRow[]> {
  const unseen = finished.length > 0 ? notInArray(titles.id, finished) : null;
  const query = (strict: boolean) =>
    db
      .select()
      .from(titles)
      .where(
        and(
          ...intentFilters(intent, kids, strict),
          ...(unseen ? [unseen] : []),
        ),
      )
      .orderBy(desc(relevance(intent)))
      .limit(POOL);
  const [similar, strict] = await Promise.all([
    similarTitles(intent.similarTo, kids),
    query(true),
  ]);
  const relaxed = strict.length < STRICT_MINIMUM ? await query(false) : [];
  const pool = new Map<string, TitleRow>();
  for (const row of [...similar, ...strict, ...relaxed]) {
    if (!finished.includes(row.id) && !pool.has(row.id)) pool.set(row.id, row);
  }
  return [...pool.values()].slice(0, POOL);
}

function fallbackPicks(pool: TitleRow[]): Recommendation[] {
  return pool.slice(0, PICKS).map((row) => ({
    title: serializeSummary(row),
    reason: row.tagline ?? "A close match for what you asked for",
  }));
}

async function generate(
  profiles: ProfileRow[],
  prompt: string,
): Promise<AssistantResult> {
  const kids = profiles.some((profile) => profile.kids);
  const [intent, histories] = await Promise.all([
    readIntent(prompt, kids),
    Promise.all(profiles.map(profileHistory)),
  ]);
  const history = histories.flat();
  const finished = [
    ...new Set(
      history
        .filter((item) => item.signal === "finished")
        .map((item) => item.id),
    ),
  ];
  const pool = await assistantPool(intent, kids, finished);
  if (pool.length === 0) return { prompt, picks: [], personal: false };
  const picks = await askWeb({
    audience: profiles.map((profile) => ({
      name: profile.name,
      kids: profile.kids,
      favoriteGenres: profile.favoriteGenres,
    })),
    history: history.slice(0, 60),
    candidates: pool.map((row) => ({
      ...candidate(row),
      overview: row.overview?.slice(0, OVERVIEW_CHARS) ?? null,
    })),
    count: PICKS,
    prompt,
  });
  const byId = new Map(pool.map((row) => [row.id, row]));
  const chosen: Recommendation[] = [];
  for (const pick of picks ?? []) {
    const row = byId.get(pick.id);
    if (!row || chosen.some((item) => item.title.id === pick.id)) continue;
    chosen.push({ title: serializeSummary(row), reason: pick.reason });
  }
  return chosen.length > 0
    ? { prompt, picks: chosen, personal: true }
    : { prompt, picks: fallbackPicks(pool), personal: false };
}

const cache = new Map<string, { at: number; result: AssistantResult }>();
const inFlight = new Map<string, Promise<AssistantResult>>();

/** The same question from the same sofa within half an hour is answered once. */
export async function askAssistant(
  profiles: ProfileRow[],
  prompt: string,
): Promise<AssistantResult> {
  const key = `${audienceKey(profiles)}\n${prompt.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  const running = inFlight.get(key);
  if (running) return running;
  const job = generate(profiles, prompt)
    .then((result) => {
      if (result.personal) {
        cache.delete(key);
        cache.set(key, { at: Date.now(), result });
        for (const oldest of cache.keys()) {
          if (cache.size <= CACHE_ENTRIES) break;
          cache.delete(oldest);
        }
      }
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
