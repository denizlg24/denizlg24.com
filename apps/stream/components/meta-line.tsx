import {
  formatRuntime,
  type TitleSummary,
  titleYears,
} from "@repo/schemas/stream";

import { Rating } from "@/components/rating";

const TYPE_LABEL = {
  movie: "Film",
  series: "Series",
  miniseries: "Limited series",
};

/** Facts separated by space, not punctuation: each is its own short token. */
export function MetaLine({
  title,
  certification,
  className = "",
}: {
  title: TitleSummary;
  certification?: string | null;
  className?: string;
}) {
  const parts = [
    TYPE_LABEL[title.type],
    titleYears(title),
    title.type === "movie" ? formatRuntime(title.runtimeMinutes) : null,
  ].filter((part): part is string => Boolean(part));
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-paper/70 ${className}`}
    >
      <Rating value={title.rating} className="font-bold" />
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
      {certification ? (
        <span className="rounded-[4px] px-1.5 py-px text-xs font-bold ring-1 ring-paper/35">
          {certification}
        </span>
      ) : null}
    </div>
  );
}
