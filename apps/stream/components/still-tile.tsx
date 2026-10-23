import { type TitleSummary, titleYears, tmdbImage } from "@repo/schemas/stream";
import Link from "next/link";

import { Rating } from "@/components/rating";

/**
 * A landscape still with the title set on it — the programme's unit. Falls
 * back to the poster, cropped, when TMDB has no backdrop.
 */
export function StillTile({
  title,
  note,
  progress,
  size = "md",
  className = "",
  href,
}: {
  title: TitleSummary;
  note?: string;
  progress?: number;
  size?: "md" | "lg";
  className?: string;
  href?: string;
}) {
  const still =
    tmdbImage(title.backdropPath, "w780") ??
    tmdbImage(title.posterPath, "w500");
  return (
    <Link
      href={href ?? `/title/${title.id}`}
      data-nav
      className={`group block rounded-xl outline-offset-4 ${className}`}
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-lift">
        {still ? (
          <img
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] group-focus-visible:scale-[1.04]"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 space-y-1 p-4 md:p-5">
          <h3
            className={`font-display text-balance text-paper ${size === "lg" ? "text-4xl md:text-5xl" : "text-3xl"}`}
          >
            {title.title}
          </h3>
          <div className="flex items-center gap-3 text-sm text-paper/70">
            <Rating value={title.rating} className="font-bold" />
            <span>{titleYears(title)}</span>
          </div>
        </div>
        {progress !== undefined ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-paper/15">
            <div
              className="h-full bg-amber"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      {note ? (
        <p className="mt-3 line-clamp-2 max-w-[48ch] text-[0.95rem] leading-snug text-paper/75">
          {note}
        </p>
      ) : null}
    </Link>
  );
}
