import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { namesFor, normaliseName } from "../entities";
import { altJson } from "../http";
import { AltBadRequest, type AltResult, AltUnavailable } from "../types";
import { mean, zScore } from "./stats";
import type { AttentionPoint, AttentionTicker } from "./types";

const sparql = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        article: z.object({ value: z.string() }),
        itemLabel: z.object({ value: z.string() }).optional(),
      }),
    ),
  }),
});
const mapping = z.object({ article: z.string() });
const views = z.object({
  items: z.array(z.object({ timestamp: z.string(), views: z.number() })),
});

const WIKI_PREFIX = "https://en.wikipedia.org/wiki/";

export function pickArticle(
  bindings: z.infer<typeof sparql>["results"]["bindings"],
  search: string,
): string | null {
  const articles = bindings
    .filter((b) => b.article.value.startsWith(WIKI_PREFIX))
    .map((b) => ({
      title: b.article.value.slice(WIKI_PREFIX.length),
      label: b.itemLabel?.value ?? "",
    }));
  const best =
    articles.find((a) => normaliseName(a.label) === search) ??
    articles.find(
      (a) =>
        normaliseName(decodeURIComponent(a.title).replaceAll("_", " ")) ===
        search,
    ) ??
    articles[0];
  return best?.title ?? null;
}

async function articleFor(symbol: string, search: string) {
  return cached({
    source: "wikidata-ticker",
    key: symbol,
    ttlMs: 30 * 86_400_000,
    schema: mapping,
    load: async () => {
      const query = `SELECT ?article ?itemLabel WHERE { ?item p:P414 ?s . ?s pq:P249 "${symbol}" . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 10`;
      const result = sparql.parse(
        await altJson<unknown>(
          "Wikidata",
          `https://query.wikidata.org/sparql?${new URLSearchParams({ format: "json", query })}`,
        ),
      );
      const article = pickArticle(result.results.bindings, search);
      if (!article)
        throw new AltUnavailable(
          `No Wikipedia article is linked to ${symbol}.`,
          404,
          false,
        );
      return { article };
    },
  });
}

const stamp = (ms: number) =>
  `${new Date(ms).toISOString().slice(0, 10).replaceAll("-", "")}00`;

export function attentionStats(points: AttentionPoint[]) {
  const latest = points.at(-1) ?? null;
  const baseline = points.slice(-31, -1).map((p) => p.views);
  return {
    latest,
    mean30: baseline.length >= 10 ? mean(baseline) : null,
    zScore30:
      latest && baseline.length >= 10 ? zScore(latest.views, baseline) : null,
  };
}

export async function wikiTicker(
  rawSymbol: string,
  days: number,
): Promise<AltResult<AttentionTicker>> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))
    throw new AltBadRequest("Invalid symbol.");
  const names = await namesFor(symbol);
  if (!names)
    throw new AltUnavailable(`${symbol} is not an SEC registrant.`, 404, false);
  const { value: map } = await articleFor(symbol, names.search);
  const span = Math.min(Math.max(days, 35), 365);
  const end = Date.now() - 86_400_000;
  const start = end - (span - 1) * 86_400_000;
  const { value, fetchedAt, stale } = await cached({
    source: "wikimedia-pageviews",
    key: `${map.article}:${stamp(start)}`,
    ttlMs: 6 * 3_600_000,
    schema: views,
    load: async () =>
      views.parse(
        await altJson<unknown>(
          "Wikimedia",
          `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${map.article}/daily/${stamp(start)}/${stamp(end)}`,
        ),
      ),
  });
  const points = value.items.map((item) => ({
    date: `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-${item.timestamp.slice(6, 8)}`,
    views: item.views,
  }));
  return {
    data: {
      symbol,
      article: decodeURIComponent(map.article).replaceAll("_", " "),
      points,
      ...attentionStats(points),
    },
    source: "Wikimedia pageviews (en.wikipedia, all-access, user)",
    asOf: points.at(-1)?.date ?? null,
    fetchedAt,
    stale,
  };
}
