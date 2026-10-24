import { formatRuntime, titleYears, tmdbImage } from "@repo/schemas/stream";
import { Clapperboard, Play } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MetaLine } from "@/components/meta-line";
import { PosterImage, PosterLink } from "@/components/poster";
import { SaveButton } from "@/components/save-button";
import { Episodes } from "@/components/title/episodes";
import { TopBar } from "@/components/top-bar";
import { audienceRules } from "@/lib/audience-rules";
import {
  findProgress,
  findTitle,
  inWatchlist,
  listEpisodes,
  nearbyTitles,
  titleDetail,
} from "@/lib/catalog";
import { enrichIfMissing } from "@/lib/tmdb";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export async function generateMetadata({
  params,
}: PageProps<"/title/[id]">): Promise<Metadata> {
  const row = await findTitle((await params).id);
  return { title: row?.title ?? "Not found" };
}

const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language" });

function languageName(code: string | null): string | null {
  if (!code) return null;
  try {
    return LANGUAGES.of(code) ?? null;
  } catch {
    return null;
  }
}

export default async function TitlePage({ params }: PageProps<"/title/[id]">) {
  const { id } = await params;
  const viewer = await requireViewer(`/title/${id}`);
  const found = await findTitle(id);
  if (!found) notFound();
  const row = await enrichIfMissing(found);
  const rules = audienceRules(viewer.audience);
  const lead = viewer.audience[0];
  const [title, saved, progress, nearby] = await Promise.all([
    titleDetail(row),
    inWatchlist(lead.id, row.id),
    findProgress(lead.id, row.id),
    nearbyTitles(row, rules),
  ]);
  const classic = viewer.layout === "classic";
  const currentEpisode = progress?.episodeId
    ? (await listEpisodes(row.id, null)).find(
        (episode) => episode.id === progress.episodeId,
      )
    : null;
  const backdrop = tmdbImage(title.backdropPath, "w1280");
  const resuming = progress && !progress.completed;
  const language = languageName(title.originalLanguage);
  const billing: [string, string][] = [
    [
      "Type",
      { movie: "Film", series: "Series", miniseries: "Limited series" }[
        title.type
      ],
    ],
    ["Released", titleYears(title)],
    ...(title.runtimeMinutes
      ? [
          [
            title.type === "movie" ? "Runtime" : "Episodes run",
            formatRuntime(title.runtimeMinutes),
          ] as [string, string],
        ]
      : []),
    ...(title.episodeCount > 0
      ? [
          [
            "Episodes",
            `${title.episodeCount} across ${title.seasons.length} season${title.seasons.length === 1 ? "" : "s"}`,
          ] as [string, string],
        ]
      : []),
    ...(language ? [["Language", language] as [string, string]] : []),
    ...(title.certification
      ? [["Rated", title.certification] as [string, string]]
      : []),
    ...(title.rating
      ? [
          [
            "IMDb",
            `${title.rating.toFixed(1)} out of 10, from ${title.votes.toLocaleString()} votes`,
          ] as [string, string],
        ]
      : []),
  ];

  return (
    <div className="min-h-dvh">
      <TopBar
        audience={audienceProfiles(viewer)}
        layout={viewer.layout}
        overlay
      />
      <section className="relative isolate overflow-hidden">
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            className="absolute inset-0 -z-20 size-full object-cover opacity-60"
          />
        ) : null}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,#0c0b0a_8%,rgba(12,11,10,0.7)_55%,rgba(12,11,10,0.35)_100%)]" />
        <div className="mx-auto grid max-w-[1600px] items-end gap-10 px-5 pt-40 pb-14 md:grid-cols-[18rem_1fr] md:px-10 md:pt-56">
          <PosterImage
            title={title}
            className="hidden shadow-2xl md:block"
            eager
            sizes="288px"
          />
          <div className="space-y-6 animate-rise">
            <h1
              className={`font-display text-balance ${classic ? "text-7xl" : "text-7xl md:text-[6.5rem]"}`}
            >
              {title.title}
            </h1>
            <MetaLine title={title} certification={title.certification} />
            {title.originalTitle ? (
              <p className="text-lg text-paper/55">{title.originalTitle}</p>
            ) : null}
            {title.tagline ? (
              <p className="max-w-[48ch] text-xl text-paper/80">
                {title.tagline}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/watch/${title.id}${resuming && progress.episodeId ? `?episode=${progress.episodeId}` : ""}`}
                data-nav
                data-nav-autofocus
                className={`flex items-center gap-3 rounded-full bg-amber font-bold text-ink transition-transform hover:scale-[1.02] ${classic ? "px-9 py-4 text-xl" : "px-8 py-4 text-lg"}`}
              >
                <Play className="size-5 fill-current" strokeWidth={0} />
                {resuming
                  ? title.type === "movie"
                    ? "Continue watching"
                    : "Continue series"
                  : progress?.completed && title.type !== "movie"
                    ? "Continue series"
                    : "Play"}
              </Link>
              <SaveButton
                titleId={title.id}
                saved={saved}
                size={classic ? "lg" : "md"}
                labels={
                  classic
                    ? { off: "Add to my list", on: "On my list" }
                    : undefined
                }
              />
              {title.trailerKey ? (
                <Link
                  href={`/watch/${title.id}?trailer=1`}
                  data-nav
                  className={`flex items-center gap-2 rounded-full border border-hairline px-6 py-3 transition-colors hover:border-paper/40 ${classic ? "text-xl" : ""}`}
                >
                  <Clapperboard className="size-5" />
                  Watch the trailer
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1600px] gap-16 px-5 py-12 md:px-10 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-16">
          {title.overview ? (
            <p
              className={`max-w-3xl leading-relaxed text-paper/90 ${classic ? "text-2xl" : "text-xl"}`}
            >
              {title.overview}
            </p>
          ) : (
            <p className="text-muted">
              We don't have a description for this one yet.
            </p>
          )}
          {title.type !== "movie" && title.seasons.length > 0 ? (
            <Episodes
              seriesId={title.id}
              seasons={title.seasons}
              initialSeason={currentEpisode?.season ?? title.seasons[0]}
              currentEpisodeId={progress?.episodeId ?? null}
              completed={progress?.completed ?? false}
            />
          ) : null}
          {title.cast.length > 0 ? (
            <section className="space-y-6">
              <h2 className="border-b border-hairline pb-4 font-display text-3xl">
                Cast
              </h2>
              <ul className="scrollbar-none -mx-5 flex gap-6 overflow-x-auto px-5 md:-mx-10 md:px-10">
                {title.cast.map((person) => {
                  const photo = tmdbImage(person.profilePath, "w185");
                  return (
                    <li
                      key={`${person.name}-${person.character}`}
                      className="w-28 shrink-0 space-y-2"
                    >
                      <Link
                        href={`/actor/${encodeURIComponent(person.name)}`}
                        data-nav
                        className="block space-y-2 rounded-xl outline-offset-4 hover:text-amber"
                      >
                        {photo ? (
                          <img
                            src={photo}
                            alt=""
                            loading="lazy"
                            className="aspect-square w-full rounded-full object-cover grayscale-[30%]"
                          />
                        ) : (
                          <div className="grid aspect-square w-full place-items-center rounded-full bg-lift font-display text-3xl text-faint">
                            {person.name.charAt(0)}
                          </div>
                        )}
                        <p className="text-sm leading-tight">{person.name}</p>
                        {person.character ? (
                          <p className="text-xs leading-tight text-muted">
                            {person.character}
                          </p>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
        <aside className="space-y-12">
          <dl className="space-y-0 border-t border-hairline">
            {billing.map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[7rem_1fr] gap-4 border-b border-hairline py-3"
              >
                <dt className="text-sm text-paper/50">{label}</dt>
                <dd className="text-sm text-paper">{value}</dd>
              </div>
            ))}
            {title.genres.length > 0 ? (
              <div className="grid grid-cols-[7rem_1fr] gap-4 border-b border-hairline py-3">
                <dt className="text-sm text-paper/50">Genre</dt>
                <dd className="flex flex-wrap gap-x-3 text-sm">
                  {title.genres.map((genre) => (
                    <span key={genre}>{genre}</span>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>

      {nearby.length > 0 ? (
        <section className="mx-auto max-w-[1600px] space-y-6 px-5 pb-20 md:px-10">
          <div className="flex items-baseline justify-between border-b border-hairline pb-4">
            <h2 className="font-display text-3xl">
              {classic ? "You might also like" : "Nearby on the map"}
            </h2>
            {classic ? null : (
              <Link
                href={`/map?focus=${title.id}`}
                data-nav
                className="text-sm text-muted hover:text-paper"
              >
                Open the map
              </Link>
            )}
          </div>
          <div className="scrollbar-none -mx-5 flex snap-x gap-5 overflow-x-auto px-5 pb-2 md:-mx-10 md:px-10">
            {nearby.map((item) => (
              <PosterLink
                key={item.id}
                title={item}
                className="w-36 shrink-0 snap-start md:w-44"
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
