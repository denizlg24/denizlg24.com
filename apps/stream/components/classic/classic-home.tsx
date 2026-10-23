import type { Home, Rail, TitleSummary } from "@repo/schemas/stream";
import { Play } from "lucide-react";
import Link from "next/link";

import { MetaLine } from "@/components/meta-line";
import { PosterImage } from "@/components/poster";

function BigPoster({
  title,
  note,
  progress,
}: {
  title: TitleSummary;
  note?: string;
  progress?: number;
}) {
  return (
    <Link
      href={`/title/${title.id}`}
      data-nav
      className="group block w-48 shrink-0 snap-start rounded-lg md:w-56"
    >
      <div className="relative">
        <PosterImage title={title} sizes="224px" />
        {progress !== undefined ? (
          <div className="absolute inset-x-3 bottom-3 h-1.5 overflow-hidden rounded-full bg-paper/25">
            <div
              className="h-full bg-amber"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-lg leading-snug text-paper">{title.title}</p>
      {note ? (
        <p className="mt-1 text-base leading-snug text-muted">{note}</p>
      ) : null}
    </Link>
  );
}

function Row({ rail }: { rail: Rail }) {
  return (
    <section className="space-y-5">
      <h2 className="text-3xl font-semibold">{rail.label}</h2>
      <div className="scrollbar-none -mx-6 flex snap-x gap-6 overflow-x-auto px-6 pb-3 md:-mx-12 md:px-12">
        {rail.kind === "continue"
          ? rail.items.map((item) => (
              <BigPoster
                key={item.title.id}
                title={item.title}
                note="Continue watching"
                progress={
                  item.progress.durationS > 0
                    ? item.progress.positionS / item.progress.durationS
                    : 0
                }
              />
            ))
          : rail.kind === "recommended"
            ? rail.items.map((item) => (
                <BigPoster
                  key={item.title.id}
                  title={item.title}
                  note={item.reason}
                />
              ))
            : rail.items.map((title) => (
                <BigPoster key={title.id} title={title} />
              ))}
      </div>
    </section>
  );
}

const CLASSIC_RAILS = new Set([
  "continue",
  "recommended",
  "trending",
  "top-films",
  "top-series",
]);

export function ClassicHome({ home }: { home: Home }) {
  const rails = home.rails.filter((rail) => CLASSIC_RAILS.has(rail.id));
  const hero = home.hero;
  return (
    <div className="mx-auto max-w-[1500px] space-y-16 px-6 py-10 md:px-12">
      {hero ? (
        <section className="grid items-center gap-8 md:grid-cols-[16rem_1fr] md:gap-12">
          <PosterImage
            title={hero}
            className="hidden md:block"
            eager
            sizes="256px"
          />
          <div className="space-y-5">
            <p className="text-lg text-amber">We think you'll like this</p>
            <h1 className="text-5xl leading-tight font-semibold md:text-6xl">
              {hero.title}
            </h1>
            <MetaLine
              title={hero}
              certification={hero.certification}
              className="text-sm"
            />
            {hero.overview ? (
              <p className="max-w-2xl text-xl leading-relaxed text-paper/85">
                {hero.overview}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-4 pt-2">
              <Link
                href={`/watch/${hero.id}`}
                data-nav
                data-nav-autofocus
                className="flex items-center gap-3 rounded-full bg-paper px-9 py-4 text-xl font-semibold text-ink"
              >
                <Play className="size-6 fill-current" /> Play
              </Link>
              <Link
                href={`/title/${hero.id}`}
                data-nav
                className="rounded-full border-2 border-paper/30 px-9 py-4 text-xl"
              >
                More about it
              </Link>
            </div>
          </div>
        </section>
      ) : null}
      {rails.length === 0 ? (
        <div className="space-y-4 py-20 text-center">
          <h1 className="text-4xl font-semibold">Nothing here just yet</h1>
          <p className="text-xl text-muted">
            The films and series are still being added. Please check back a
            little later.
          </p>
        </div>
      ) : (
        rails.map((rail) => <Row key={rail.id} rail={rail} />)
      )}
    </div>
  );
}
