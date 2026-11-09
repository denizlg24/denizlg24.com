import {
  type ContinueWatchingItem,
  type TitleSummary,
  tmdbImage,
} from "@repo/schemas/stream";
import { Play } from "lucide-react";
import Link from "next/link";

import { Previewable } from "@/components/browse/preview";
import {
  episodeTag,
  ProgressBar,
  playHref,
  progressShare,
  timeLeft,
} from "@/components/title/meta";

const POSTER_SIZES =
  "(min-width: 1800px) 12vw, (min-width: 1100px) 15vw, (min-width: 800px) 19vw, (min-width: 500px) 24vw, 31vw";
const WIDE_SIZES =
  "(min-width: 1400px) 19vw, (min-width: 1100px) 23vw, (min-width: 800px) 31vw, 46vw";

const FOCUS =
  "rounded-[4px] outline-offset-2 transition-transform duration-200 focus-visible:scale-[1.04]";

export function PosterArt({
  title,
  sizes = POSTER_SIZES,
  className = "",
}: {
  title: Pick<TitleSummary, "title" | "posterPath">;
  sizes?: string;
  className?: string;
}) {
  const src = tmdbImage(title.posterPath, "w342");
  if (!src) {
    return (
      <div
        className={`flex aspect-[2/3] w-full items-end overflow-hidden rounded-[4px] bg-lift p-3 ${className}`}
      >
        <span className="line-clamp-4 font-display text-[clamp(1rem,1.6vw,1.6rem)] leading-[0.95] break-words text-paper/80">
          {title.title}
        </span>
      </div>
    );
  }
  return (
    <img
      src={src}
      srcSet={`${tmdbImage(title.posterPath, "w185")} 185w, ${src} 342w, ${tmdbImage(title.posterPath, "w500")} 500w`}
      sizes={sizes}
      alt=""
      loading="lazy"
      decoding="async"
      className={`aspect-[2/3] w-full rounded-[4px] bg-lift object-cover ${className}`}
    />
  );
}

/** A backdrop with the title treatment (or the name) set on it. */
export function WideArt({
  title,
  sizes = WIDE_SIZES,
  showName = true,
}: {
  title: TitleSummary;
  sizes?: string;
  showName?: boolean;
}) {
  const backdrop = title.backdropPath;
  const src =
    tmdbImage(backdrop, "w780") ?? tmdbImage(title.posterPath, "w500");
  const logo = tmdbImage(title.logoPath ?? null, "w185");
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[4px] bg-lift">
      {src ? (
        <img
          src={src}
          srcSet={
            backdrop
              ? `${tmdbImage(backdrop, "w500")} 500w, ${src} 780w`
              : undefined
          }
          sizes={sizes}
          alt=""
          loading="lazy"
          decoding="async"
          className={`size-full object-cover ${backdrop ? "" : "object-[50%_20%]"}`}
        />
      ) : null}
      {showName ? (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(20deg,rgb(12_11_10/0.75),transparent_55%)]" />
          <div className="absolute inset-x-[6%] bottom-[8%]">
            {logo ? (
              <img
                src={logo}
                alt=""
                loading="lazy"
                className="max-h-[2.75rem] max-w-[55%] object-contain object-left-bottom drop-shadow-[0_2px_6px_rgb(0_0_0/0.6)]"
              />
            ) : (
              <p className="line-clamp-2 max-w-[80%] font-display text-[clamp(1rem,1.5vw,1.6rem)] leading-[0.95] break-words drop-shadow-[0_2px_6px_rgb(0_0_0/0.6)]">
                {title.title}
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function PosterTile({
  title,
  className = "",
}: {
  title: TitleSummary;
  className?: string;
}) {
  return (
    <Previewable title={title} className={className}>
      <Link
        href={`/title/${title.id}`}
        data-nav
        aria-label={title.title}
        className={`block ${FOCUS}`}
      >
        <PosterArt title={title} />
      </Link>
    </Previewable>
  );
}

export function WideTile({
  title,
  className = "",
}: {
  title: TitleSummary;
  className?: string;
}) {
  return (
    <Previewable title={title} className={className}>
      <Link
        href={`/title/${title.id}`}
        data-nav
        aria-label={title.title}
        className={`block ${FOCUS}`}
      >
        <WideArt title={title} />
      </Link>
    </Previewable>
  );
}

export function RankTile({
  title,
  rank,
  className = "",
}: {
  title: TitleSummary;
  rank: number;
  className?: string;
}) {
  return (
    <Previewable title={title} className={className}>
      <Link
        href={`/title/${title.id}`}
        data-nav
        aria-label={`Number ${rank}: ${title.title}`}
        className={`flex aspect-[4/3] items-stretch ${FOCUS}`}
      >
        <svg
          viewBox="0 0 100 150"
          preserveAspectRatio="xMaxYMax meet"
          aria-hidden
          className="h-full w-1/2 shrink-0 overflow-visible"
        >
          <text
            x={rank === 10 ? 112 : 104}
            y={146}
            textAnchor="end"
            fontSize={rank === 10 ? 132 : 172}
            letterSpacing={rank === 10 ? -14 : 0}
            strokeWidth={3}
            className="rank-numeral font-display font-black"
          >
            {rank}
          </text>
        </svg>
        <div className="relative z-10 w-1/2 shrink-0">
          <PosterArt
            title={title}
            sizes="(min-width: 1100px) 10vw, (min-width: 800px) 15vw, 23vw"
            className="h-full"
          />
        </div>
      </Link>
    </Previewable>
  );
}

export function ContinueTile({
  item,
  className = "",
}: {
  item: ContinueWatchingItem;
  className?: string;
}) {
  const left = timeLeft(item.progress);
  const tag = episodeTag(item.episode);
  return (
    <Previewable
      title={item.title}
      progress={item.progress}
      className={className}
    >
      <Link
        href={playHref(item.title.id, item.progress)}
        data-nav
        aria-label={`Continue ${item.title.title}`}
        className={`group block ${FOCUS}`}
      >
        <div className="relative">
          <WideArt title={item.title} />
          <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="grid size-12 place-items-center rounded-full border-2 border-paper bg-ink/50">
              <Play
                className="size-5 translate-x-px fill-paper"
                strokeWidth={0}
              />
            </span>
          </span>
        </div>
        <ProgressBar
          share={progressShare(item.progress)}
          className="mt-1.5 rounded-full"
        />
        <p className="mt-1.5 flex min-w-0 items-baseline gap-2 text-[0.8rem] text-paper/70">
          <span className="truncate text-paper/90">{item.title.title}</span>
          {tag ? <span className="shrink-0 font-bold">{tag}</span> : null}
          {left ? <span className="shrink-0">{left}</span> : null}
        </p>
      </Link>
    </Previewable>
  );
}
