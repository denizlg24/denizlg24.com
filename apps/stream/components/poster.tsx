import { type TitleSummary, titleYears, tmdbImage } from "@repo/schemas/stream";
import Link from "next/link";

import { Rating } from "@/components/rating";

export function PosterImage({
  title,
  className = "",
  sizes = "(min-width: 1024px) 12vw, 30vw",
  eager = false,
}: {
  title: Pick<TitleSummary, "title" | "posterPath">;
  className?: string;
  sizes?: string;
  eager?: boolean;
}) {
  const src = tmdbImage(title.posterPath, "w342");
  if (!src) {
    return (
      <div
        className={`flex aspect-[2/3] items-end rounded-[4px] bg-lift p-3 font-display text-lg leading-tight text-muted ring-1 ring-hairline ring-inset ${className}`}
      >
        {title.title}
      </div>
    );
  }
  return (
    <img
      src={src}
      srcSet={`${tmdbImage(title.posterPath, "w185")} 185w, ${src} 342w, ${tmdbImage(title.posterPath, "w500")} 500w`}
      sizes={sizes}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`aspect-[2/3] w-full rounded-[4px] bg-lift object-cover ring-1 ring-hairline ring-inset ${className}`}
    />
  );
}

export function PosterLink({
  title,
  caption = true,
  className = "",
  progress,
}: {
  title: TitleSummary;
  caption?: boolean;
  className?: string;
  progress?: number;
}) {
  return (
    <Link
      href={`/title/${title.id}`}
      data-nav
      className={`group block rounded-[6px] outline-offset-4 ${className}`}
    >
      <div className="relative transition-transform duration-300 group-hover:-translate-y-1 group-focus-visible:-translate-y-1">
        <PosterImage title={title} />
        {progress !== undefined ? (
          <div className="absolute inset-x-2 bottom-2 h-[3px] overflow-hidden rounded-full bg-paper/20">
            <div
              className="h-full bg-amber"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      {caption ? (
        <div className="mt-2.5 space-y-0.5">
          <div className="truncate text-sm text-paper">{title.title}</div>
          <div className="flex items-center gap-2.5 text-[0.8rem] text-paper/55">
            <span>{titleYears(title)}</span>
            <Rating value={title.rating} />
          </div>
        </div>
      ) : null}
    </Link>
  );
}
