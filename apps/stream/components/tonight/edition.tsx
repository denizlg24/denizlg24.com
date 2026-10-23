import { formatRuntime, type Tonight, tmdbImage } from "@repo/schemas/stream";
import { ArrowRight, Clock, Play, Users } from "lucide-react";
import Link from "next/link";

import { MetaLine } from "@/components/meta-line";
import { PosterLink } from "@/components/poster";
import { joinNames } from "@/components/profile-disc";
import { SaveButton } from "@/components/save-button";
import { StillTile } from "@/components/still-tile";

function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function minutesLeft(positionS: number, durationS: number): string {
  const left = Math.max(1, Math.round((durationS - positionS) / 60));
  return `${formatRuntime(left)} left`;
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h2 className="font-display text-5xl md:text-6xl">{title}</h2>
        {aside ? <div className="pb-1.5 text-paper/60">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Lead({
  lead,
  saved,
  audience,
}: {
  lead: NonNullable<Tonight["lead"]>;
  saved: boolean;
  audience: string;
}) {
  const { title, reason } = lead;
  const backdrop = tmdbImage(title.backdropPath, "original");
  return (
    <section className="relative isolate flex min-h-[86dvh] items-end overflow-hidden">
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          className="absolute inset-0 -z-20 size-full animate-drift object-cover"
        />
      ) : null}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#0c0b0a_0%,rgba(12,11,10,0.82)_38%,rgba(12,11,10,0.15)_72%,rgba(12,11,10,0.35)_100%),linear-gradient(0deg,#0c0b0a_0%,transparent_50%)]" />
      <div className="mx-auto w-full max-w-[1600px] px-5 pb-14 md:px-10 md:pb-20">
        <div className="max-w-3xl animate-rise">
          <h1 className="font-display text-7xl text-balance md:text-8xl xl:text-[7.5rem]">
            {title.title}
          </h1>
          <MetaLine
            title={title}
            certification={title.certification}
            className="mt-5"
          />
          <p className="mt-6 max-w-[52ch] text-xl leading-relaxed text-paper/90 md:text-2xl">
            {reason}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={`/watch/${title.id}`}
              data-nav
              data-nav-autofocus
              className="flex items-center gap-3 rounded-full bg-amber px-8 py-4 text-lg font-bold text-ink transition-transform hover:scale-[1.02]"
            >
              <Play className="size-5 fill-current" strokeWidth={0} />
              Play
            </Link>
            <Link
              href={`/title/${title.id}`}
              data-nav
              className="rounded-full bg-paper/10 px-7 py-4 text-lg backdrop-blur-sm transition-colors hover:bg-paper/20"
            >
              Details
            </Link>
            <SaveButton titleId={title.id} saved={saved} />
          </div>
          <p className="mt-8 flex items-center gap-2 text-sm text-paper/55">
            <Users className="size-4" strokeWidth={1.75} aria-hidden />
            Chosen for {audience}
          </p>
        </div>
      </div>
    </section>
  );
}

function DoubleFeature({
  pair,
}: {
  pair: NonNullable<Tonight["doubleFeature"]>;
}) {
  const total =
    (pair.first.runtimeMinutes ?? 0) + (pair.second.runtimeMinutes ?? 0);
  return (
    <Section
      title="Double feature"
      aside={
        <span className="flex items-center gap-2">
          <Clock className="size-4" strokeWidth={1.75} aria-hidden />
          {formatRuntime(total)} for both
        </span>
      }
    >
      <div className="grid items-center gap-5 md:grid-cols-[1fr_auto_1fr]">
        <StillTile title={pair.first} size="lg" />
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-raised text-amber ring-1 ring-hairline">
          <ArrowRight className="size-6 max-md:rotate-90" strokeWidth={1.75} />
          <span className="sr-only">then</span>
        </span>
        <StillTile title={pair.second} size="lg" />
      </div>
      <p className="max-w-[60ch] text-lg text-paper/75">{pair.reason}</p>
    </Section>
  );
}

function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="scrollbar-none -mx-5 flex snap-x gap-5 overflow-x-auto px-5 pb-2 md:-mx-10 md:px-10">
      {children}
    </div>
  );
}

export function Edition({
  tonight,
  leadSaved,
}: {
  tonight: Tonight;
  leadSaved: boolean;
}) {
  const names = joinNames(tonight.audience.map((profile) => profile.name));
  const empty = !tonight.lead && tonight.programme.length === 0;
  return (
    <>
      {tonight.lead ? (
        <Lead lead={tonight.lead} saved={leadSaved} audience={names} />
      ) : (
        <div className="h-28" />
      )}
      <div className="mx-auto max-w-[1600px] space-y-24 px-5 py-16 md:px-10">
        {empty ? (
          <div className="max-w-xl space-y-4 py-16">
            <h1 className="font-display text-6xl">Tonight is on its way</h1>
            <p className="text-lg text-paper/70">
              The catalogue is still filling up. Once it has, you'll find a
              hand-picked programme here every evening.
            </p>
          </div>
        ) : null}
        {tonight.continue.length > 0 ? (
          <Section title="Continue watching">
            <Strip>
              {tonight.continue.map((item) => (
                <StillTile
                  key={item.title.id}
                  title={item.title}
                  className="w-80 shrink-0 snap-start md:w-96"
                  href={`/watch/${item.title.id}${item.progress.episodeId ? `?episode=${item.progress.episodeId}` : ""}`}
                  note={minutesLeft(
                    item.progress.positionS,
                    item.progress.durationS,
                  )}
                  progress={
                    item.progress.durationS > 0
                      ? item.progress.positionS / item.progress.durationS
                      : 0
                  }
                />
              ))}
            </Strip>
          </Section>
        ) : null}
        {tonight.programme.length > 0 ? (
          <Section title="Also tonight" aside={longDate(tonight.date)}>
            <div className="grid gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-3">
              {tonight.programme.map((item) => (
                <StillTile
                  key={item.title.id}
                  title={item.title}
                  note={item.reason}
                />
              ))}
            </div>
          </Section>
        ) : null}
        {tonight.doubleFeature ? (
          <DoubleFeature pair={tonight.doubleFeature} />
        ) : null}
        {tonight.fresh.length > 0 ? (
          <Section title="New this year">
            <Strip>
              {tonight.fresh.map((title) => (
                <PosterLink
                  key={title.id}
                  title={title}
                  className="w-40 shrink-0 snap-start md:w-48"
                />
              ))}
            </Strip>
          </Section>
        ) : null}
        <footer className="space-y-4 border-t border-hairline pt-10 pb-6">
          <p className="text-lg text-paper/60">
            A new programme arrives tomorrow.
          </p>
          <p className="text-xs text-paper/40">
            Film data from IMDb and TMDB. This product uses the TMDB API but is
            not endorsed or certified by TMDB.
          </p>
        </footer>
      </div>
    </>
  );
}
