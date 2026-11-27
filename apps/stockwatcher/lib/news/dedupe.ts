import { type NewsItem, newsSources } from "./types";

/** Same story if the URL matches after cleanup, or the headlines share most words. */
const titleOverlap = 0.75;

export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|guccounter|ncid|cmpid|ref$|src$|feature$)/i.test(key))
        url.searchParams.delete(key);
    url.hash = "";
    const path = url.pathname.replace(/\/+$/, "");
    const query = url.searchParams.toString();
    return `${url.hostname.replace(/^www\./, "")}${path}${query ? `?${query}` : ""}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

const stopwords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "its",
  "are",
  "was",
  "has",
  "have",
  "will",
  "into",
  "after",
  "over",
]);

export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/\s[-–|]\s[^-–|]{2,40}$/, "")
      .split(/[^\p{L}\p{N}$%.]+/u)
      .map((word) => word.replace(/\.+$/, ""))
      .filter((word) => word.length >= 3 && !stopwords.has(word)),
  );
}

export function similar(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.min(a.size, b.size) >= titleOverlap;
}

const rank = (item: NewsItem) => newsSources.indexOf(item.source);

/**
 * Merges stories reported by several sources: the primary source (filings,
 * then wires, then the rest in `newsSources` order) keeps its headline and
 * link, every source contributes its symbols, and the earliest time wins.
 */
export function dedupe(items: NewsItem[]): NewsItem[] {
  const ordered = [...items].sort(
    (a, b) => rank(a) - rank(b) || b.time - a.time,
  );
  const kept: Array<{ item: NewsItem; url: string; words: Set<string> }> = [];
  for (const item of ordered) {
    const url = canonicalUrl(item.url);
    const words = titleWords(item.title);
    const twin = kept.find(
      (entry) => entry.url === url || similar(entry.words, words),
    );
    if (!twin) {
      kept.push({ item: { ...item, symbols: [...item.symbols] }, url, words });
      continue;
    }
    twin.item.symbols = [...new Set([...twin.item.symbols, ...item.symbols])];
    if (item.time && (!twin.item.time || item.time < twin.item.time))
      twin.item.time = item.time;
    twin.item.summary ??= item.summary;
  }
  return kept.map((entry) => entry.item).sort((a, b) => b.time - a.time);
}
