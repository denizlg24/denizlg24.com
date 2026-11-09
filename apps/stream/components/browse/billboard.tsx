"use client";

import {
  type Billboard as BillboardData,
  tmdbImage,
} from "@repo/schemas/stream";
import { Info, Play } from "lucide-react";
import Link from "next/link";

import { MyListButton } from "@/components/my-list";
import { Dotted, playHref } from "@/components/title/meta";
import { MuteButton, TrailerFrame, useTrailer } from "@/components/trailer";

/**
 * The lead title, full-bleed. A still first; after a moment a muted trailer
 * fades in over it and the description steps back, as on Netflix.
 */
export function Billboard({ billboard }: { billboard: BillboardData }) {
  const { title, reason, progress } = billboard;
  const trailer = useTrailer(title.trailerKey, { pauseWhenInert: true });
  const backdrop = tmdbImage(title.backdropPath, "w1280");
  const still = tmdbImage(title.posterPath, "w780") ?? backdrop;
  const logo = tmdbImage(title.logoPath ?? null, "w500");
  const resuming = progress !== null && !progress.completed;
  const playing = trailer.visible;
  // Phones show the poster, which already carries the title art.
  const posterArt = title.posterPath ? "max-md:sr-only" : "";

  return (
    <section
      ref={trailer.box}
      aria-label={title.title}
      className="relative h-[min(150vw,82svh)] min-h-[26rem] w-full overflow-hidden bg-ink md:h-[min(56.25vw,92svh)] md:min-h-[32rem]"
    >
      <picture>
        {backdrop ? (
          <source media="(min-width: 768px)" srcSet={backdrop} />
        ) : null}
        {still ? (
          <img
            src={still}
            alt=""
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover object-top md:object-center"
          />
        ) : null}
      </picture>
      {trailer.mounted && title.trailerKey ? (
        <TrailerFrame
          trailerKey={title.trailerKey}
          frame={trailer.frame}
          visible={trailer.visible}
          onLoad={trailer.onLoad}
        />
      ) : null}
      <div className="absolute inset-0 hidden bg-[linear-gradient(77deg,rgb(12_11_10/0.8),transparent_60%)] md:block" />
      <div className="absolute inset-x-0 bottom-0 h-[45%] bg-[linear-gradient(0deg,var(--color-ink)_8%,transparent)] md:h-[30%]" />

      <div className="absolute inset-x-[var(--gutter)] bottom-8 flex flex-col items-center gap-4 text-center md:right-auto md:bottom-[16%] md:w-[min(45%,38rem)] lg:bottom-[30%] lg:w-[min(40%,38rem)] md:items-start md:text-left">
        {logo ? (
          <img
            src={logo}
            alt={title.title}
            className={`max-h-[clamp(5rem,11vw,13rem)] w-auto max-w-[min(80vw,100%)] object-contain object-bottom drop-shadow-[0_4px_16px_rgb(0_0_0/0.5)] transition-transform duration-1000 md:origin-bottom-left md:object-left-bottom ${playing ? "md:scale-[0.8]" : ""} ${posterArt}`}
          />
        ) : (
          <h1
            className={`line-clamp-3 font-display text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.9] text-balance break-words drop-shadow-[0_4px_16px_rgb(0_0_0/0.5)] transition-transform duration-1000 md:origin-bottom-left ${playing ? "md:scale-[0.85]" : ""} ${posterArt}`}
          >
            {title.title}
          </h1>
        )}
        {reason ? (
          <p className="line-clamp-1 max-w-full text-sm font-bold text-paper md:text-[clamp(1rem,1.2vw,1.35rem)]">
            {reason}
          </p>
        ) : null}
        {title.genres.length > 0 ? (
          <Dotted
            items={title.genres.slice(0, 3)}
            className="justify-center text-sm text-paper/85 md:hidden"
          />
        ) : null}
        {title.overview ? (
          <p
            className={`hidden text-[clamp(0.9rem,1.1vw,1.2rem)] leading-snug text-paper/90 drop-shadow transition-[opacity,max-height] duration-1000 lg:line-clamp-3 ${playing ? "max-h-0 opacity-0" : "max-h-[6em] opacity-100"}`}
          >
            {title.overview}
          </p>
        ) : null}
        <div className="flex w-full items-center justify-center gap-2.5 md:justify-start md:gap-3">
          {title.available ? (
            <Link
              href={playHref(title.id, progress)}
              data-nav
              data-nav-autofocus
              className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[4px] bg-paper px-5 font-bold whitespace-nowrap text-ink transition-colors hover:bg-paper/80 sm:flex-none md:h-12 md:px-7 md:text-lg"
            >
              <Play className="size-6 shrink-0 fill-current" strokeWidth={0} />
              {resuming ? "Resume" : "Play"}
            </Link>
          ) : null}
          <Link
            href={`/title/${title.id}`}
            data-nav
            className="hidden h-11 min-w-0 items-center justify-center gap-2 rounded-[4px] bg-[rgb(109_109_110/0.7)] px-5 font-bold whitespace-nowrap text-paper transition-colors hover:bg-[rgb(109_109_110/0.45)] md:flex md:h-12 md:px-7 md:text-lg"
          >
            <Info className="size-6 shrink-0" strokeWidth={2} />
            More info
          </Link>
          <span className="md:hidden">
            <MyListButton titleId={title.id} size="lg" />
          </span>
          <Link
            href={`/title/${title.id}`}
            data-nav
            aria-label={`More about ${title.title}`}
            className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-paper/60 bg-ink/30 md:hidden"
          >
            <Info className="size-5" strokeWidth={2} />
          </Link>
        </div>
      </div>

      <div className="absolute right-0 bottom-[16%] hidden items-center gap-3 md:flex lg:bottom-[30%]">
        {trailer.visible ? (
          <MuteButton muted={trailer.muted} onToggle={trailer.toggleMute} />
        ) : null}
        {title.certification ? (
          <span className="border-l-[3px] border-paper/70 bg-ink/40 py-1.5 pr-[var(--gutter)] pl-3 text-[clamp(0.9rem,1vw,1.1rem)]">
            {title.certification}
          </span>
        ) : null}
      </div>
    </section>
  );
}
