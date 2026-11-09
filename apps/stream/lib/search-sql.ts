import "server-only";

import { type SQL, sql } from "drizzle-orm";

import { titles } from "@/db/schema";

const folded = (q: string) => sql`stream_fold(${q})`;

/**
 * Titles a query could mean: a substring of the title or original title, or
 * a word-level trigram match (typos included) on the title, the people it
 * credits or its keywords. Every branch is served by a trigram index.
 */
export function searchMatch(q: string): SQL {
  const f = folded(q);
  return sql`(
    ${titles.searchTitle} like '%' || ${f} || '%'
    or ${f} <% ${titles.searchTitle}
    or ${f} <% ${titles.searchPeople}
    or ${f} <% ${titles.searchKeywords}
  )`;
}

/**
 * How well a title answers the query. An exact or leading title match wins
 * outright, a word starting with the query next, then word similarity on
 * the title, a person it credits, or a theme. Reach scales the match rather
 * than adding to it, so a famous film never outranks a closer title on fame
 * alone, yet breaks ties between equally good matches.
 */
export function searchRelevance(q: string): SQL<number> {
  const f = folded(q);
  const name = sql`stream_fold(${titles.title})`;
  return sql<number>`(
    greatest(
      (case
        when ${name} = ${f} then 3
        when ${name} like ${f} || ' %' then 2.2
        when ${name} like ${f} || '%' then 1.9
        when ${titles.searchTitle} like '% ' || ${f} || '%' then 1.4
        when ${titles.searchTitle} like '%' || ${f} || '%' then 0.8
        else 0
      end)
        + word_similarity(${f}, ${titles.searchTitle}) * 1.5
        + similarity(${f}, ${name}),
      case when ${f} <% ${titles.searchPeople}
        then word_similarity(${f}, ${titles.searchPeople}) * 2.2 else 0 end,
      case when ${f} <% ${titles.searchKeywords}
        then word_similarity(${f}, ${titles.searchKeywords}) * 1.2 else 0 end
    )
    * (0.55 + ln(1 + ${titles.votes}) * 0.04 + least(${titles.tmdbPopularity}, 300) / 1500)
  )`;
}
