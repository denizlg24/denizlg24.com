import "server-only";

import type {
  Recommendation,
  TitleSummary,
  Tonight,
} from "@repo/schemas/stream";
import { and, desc, gte, isNotNull, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { type ProfileRow, titles } from "@/db/schema";
import { audienceRules } from "@/lib/audience-rules";
import {
  audienceFilter,
  continueWatching,
  findTitle,
  serializeSummary,
  titleDetail,
} from "@/lib/catalog";
import { serializeProfile } from "@/lib/members";
import { recommendationsFor } from "@/lib/recommendations";

const PROGRAMME = 6;
const DOUBLE_FEATURE_MAX_MINUTES = 270;

export function localDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE ?? "Europe/Copenhagen",
  }).format(now);
}

/** Two compatible films, weighted toward the audience’s strongest matches. */
export function pickDoubleFeature(
  recs: Recommendation[],
): Tonight["doubleFeature"] {
  const films = recs
    .map((rec) => rec.title)
    .filter(
      (title): title is TitleSummary & { runtimeMinutes: number } =>
        title.type === "movie" && title.runtimeMinutes !== null,
    );
  let best: {
    first: TitleSummary;
    second: TitleSummary;
    genre: string;
    score: number;
    total: number;
  } | null = null;
  for (let i = 0; i < films.length; i++) {
    for (let j = i + 1; j < films.length; j++) {
      const [a, b] = [films[i], films[j]];
      const total = a.runtimeMinutes + b.runtimeMinutes;
      if (total > DOUBLE_FEATURE_MAX_MINUTES) continue;
      if (!a.originalLanguage || a.originalLanguage !== b.originalLanguage)
        continue;
      const shared = a.genres.filter((name) => b.genres.includes(name));
      const similarity =
        shared.length / new Set([...a.genres, ...b.genres]).size;
      if (similarity < 0.4) continue;
      const genre = shared.find((name) => name !== "Drama") ?? shared[0];
      if (!genre) continue;
      const score =
        similarity * 4 -
        (i + j) * 0.4 +
        ((a.rating ?? 0) + (b.rating ?? 0)) * 0.1;
      if (!best || score > best.score) {
        const [first, second] =
          (a.startYear ?? 0) <= (b.startYear ?? 0) ? [a, b] : [b, a];
        best = { first, second, genre, score, total };
      }
    }
  }
  if (!best) return null;
  return {
    first: best.first,
    second: best.second,
    reason: `Two ${best.genre.toLowerCase()} films that sit well back to back.`,
  };
}

export async function buildTonight(profiles: ProfileRow[]): Promise<Tonight> {
  const rules = audienceRules(profiles);
  const year = new Date().getUTCFullYear();
  const [recs, continuing, freshRows] = await Promise.all([
    recommendationsFor(profiles),
    Promise.all(profiles.map((profile) => continueWatching(profile.id, 10))),
    db
      .select()
      .from(titles)
      .where(
        and(
          audienceFilter(rules),
          gte(titles.startYear, year - 1),
          isNotNull(titles.posterPath),
        ) as SQL,
      )
      .orderBy(desc(titles.popularity))
      .limit(12),
  ]);

  const leadRec = recs.find((rec) => rec.title.backdropPath) ?? recs[0];
  const leadRow = leadRec ? await findTitle(leadRec.title.id) : null;
  const rest = recs.filter((rec) => rec.title.id !== leadRec?.title.id);
  const programme = rest.slice(0, PROGRAMME);

  const seen = new Set<string>();
  const merged = continuing
    .flat()
    .sort(
      (a, b) =>
        Date.parse(b.progress.updatedAt) - Date.parse(a.progress.updatedAt),
    )
    .filter((item) => {
      if (seen.has(item.title.id)) return false;
      seen.add(item.title.id);
      return true;
    })
    .slice(0, 10);

  return {
    date: localDate(),
    audience: profiles.map(serializeProfile),
    lead:
      leadRow && leadRec
        ? { title: await titleDetail(leadRow), reason: leadRec.reason }
        : null,
    programme,
    doubleFeature:
      pickDoubleFeature(rest.slice(PROGRAMME)) ?? pickDoubleFeature(rest),
    continue: merged,
    fresh: freshRows.map(serializeSummary),
  };
}
