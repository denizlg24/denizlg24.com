"use client";

import { type TitleDetail, tmdbImage } from "@repo/schemas/stream";
import { Play } from "lucide-react";
import Link from "next/link";

import { MyListButton } from "@/components/my-list";
import { MuteButton, TrailerFrame, useTrailer } from "@/components/trailer";

export function TitleHero({
  title,
  playHref,
  playLabel,
}: {
  title: TitleDetail;
  playHref: string;
  playLabel: string;
}) {
  const trailer = useTrailer(title.trailerKey, {
    delayMs: 1500,
    minWidth: 640,
  });
  const backdrop =
    tmdbImage(title.backdropPath, "w1280") ??
    tmdbImage(title.posterPath, "w780");
  const logo = tmdbImage(title.logoPath ?? null, "w500");

  return (
    <div
      ref={trailer.box}
      className="relative aspect-[4/3] w-full overflow-hidden bg-lift sm:aspect-video"
    >
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          fetchPriority="high"
          className={`absolute inset-0 size-full object-cover ${title.backdropPath ? "" : "object-[50%_20%]"}`}
        />
      ) : null}
      {trailer.mounted && title.trailerKey ? (
        <TrailerFrame
          trailerKey={title.trailerKey}
          frame={trailer.frame}
          visible={trailer.visible}
          onLoad={trailer.onLoad}
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(0deg,var(--color-raised)_2%,transparent_60%)]" />
      <div className="absolute inset-x-[5%] bottom-[6%] flex flex-col items-start gap-4 md:gap-6">
        <h2 id="title-heading" className="max-w-full">
          {logo ? (
            <img
              src={logo}
              alt={title.title}
              className="max-h-[clamp(3.5rem,12vw,8rem)] w-auto max-w-[min(65%,22rem)] object-contain object-left-bottom drop-shadow-[0_4px_16px_rgb(0_0_0/0.5)]"
            />
          ) : (
            <span className="line-clamp-2 font-display text-[clamp(2.25rem,6vw,4.5rem)] leading-[0.9] break-words drop-shadow-[0_4px_16px_rgb(0_0_0/0.5)]">
              {title.title}
            </span>
          )}
        </h2>
        <div className="flex w-full items-center gap-2.5">
          {title.available ? (
            <Link
              href={playHref}
              data-nav
              data-nav-autofocus
              className="flex h-10 min-w-0 items-center gap-2 rounded-[4px] bg-paper px-5 font-bold whitespace-nowrap text-ink transition-colors hover:bg-paper/80 md:h-11 md:px-7 md:text-lg"
            >
              <Play className="size-6 shrink-0 fill-current" strokeWidth={0} />
              <span className="truncate">{playLabel}</span>
            </Link>
          ) : (
            <span className="flex h-10 items-center rounded-[4px] bg-paper/15 px-4 text-sm whitespace-nowrap text-paper/80 md:h-11">
              Not available to play yet
            </span>
          )}
          <MyListButton titleId={title.id} size="lg" />
          {trailer.visible ? (
            <MuteButton
              muted={trailer.muted}
              onToggle={trailer.toggleMute}
              className="ml-auto"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
