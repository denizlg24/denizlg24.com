import type { TitleQuery } from "@repo/schemas/stream";

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A plain name for a grid built from `titleQuerySchema` params. */
export function queryHeading(query: TitleQuery, label?: string): string {
  if (label) return label;
  const kind =
    query.type === "movie"
      ? "films"
      : query.type === "series" || query.type === "miniseries"
        ? "series"
        : "films and series";
  if (query.keyword) return capitalise(query.keyword);
  if (query.actor) return query.actor;
  if (query.q) return `Titles matching “${query.q}”`;
  if (query.genres && query.genres.length > 0) {
    return `${query.genres.join(" and ")} ${kind}`;
  }
  return capitalise(kind);
}
