import {
  type Episode,
  formatRuntime,
  type Progress,
  type TitleDetail,
  titleYears,
} from "@repo/schemas/stream";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";

import { Episodes } from "@/components/title/episodes";
import {
  Dotted,
  MaturityBadge,
  ProgressBar,
  progressShare,
  RatingValue,
  TYPE_LABEL,
  timeLeft,
} from "@/components/title/meta";
import { SimilarCard } from "@/components/title/similar-card";
import { TitleHero } from "@/components/title/title-hero";
import { audienceRules } from "@/lib/audience-rules";
import {
  findProgress,
  findTitle,
  listEpisodes,
  nearbyTitles,
  titleDetail,
} from "@/lib/catalog";
import { similarTitles } from "@/lib/similar";
import { enrichIfMissing } from "@/lib/tmdb";
import { requireViewer } from "@/lib/viewer";

const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language" });

function languageName(code: string | null): string | null {
  if (!code) return null;
  try {
    return LANGUAGES.of(code) ?? null;
  } catch {
    return null;
  }
}

function actorHref(name: string): string {
  return `/actor/${encodeURIComponent(name)}`;
}

function LinkList({ items }: { items: { label: string; href: string }[] }) {
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? ", " : ""}
          <Link
            href={item.href}
            data-nav
            className="rounded text-paper/90 hover:underline"
          >
            {item.label}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-sm leading-relaxed break-words">
      <span className="text-paper/50">{label}: </span>
      {children}
    </p>
  );
}

function scale(title: TitleDetail): string | null {
  if (title.type === "movie") return formatRuntime(title.runtimeMinutes);
  if (title.seasons.length > 1) return `${title.seasons.length} seasons`;
  if (title.episodeCount > 0)
    return `${title.episodeCount} episode${title.episodeCount === 1 ? "" : "s"}`;
  return TYPE_LABEL[title.type];
}

function playState(
  title: TitleDetail,
  progress: Progress | null,
  episode: Episode | null,
): { href: string; label: string; note: string[] } {
  const resuming = progress !== null && !progress.completed;
  const href =
    resuming && progress.episodeId
      ? `/watch/${title.id}?episode=${progress.episodeId}`
      : `/watch/${title.id}`;
  if (!resuming) {
    return {
      href,
      label:
        progress?.completed && title.type !== "movie" ? "Continue" : "Play",
      note: [],
    };
  }
  const code =
    episode && episode.season !== null && episode.episode !== null
      ? `S${episode.season}:E${episode.episode}`
      : null;
  return {
    href,
    label: code ? `Resume ${code}` : "Resume",
    note: [code, episode?.title ?? null, timeLeft(progress)].filter(
      (part): part is string => Boolean(part),
    ),
  };
}

/**
 * Everything about one title. The modal over a browse page and the
 * `/title/[id]` page both render this; only the frame around it differs.
 */
export async function TitleDetails({
  id,
  variant,
}: {
  id: string;
  variant: "modal" | "page";
}) {
  const viewer = await requireViewer(`/title/${id}`);
  const found = await findTitle(id);
  if (!found) notFound();
  const row = await enrichIfMissing(found);
  const lead = viewer.audience[0];
  const [title, progress, similar] = await Promise.all([
    titleDetail(row),
    findProgress(lead.id, row.id),
    similarTitles(row, viewer.audience),
  ]);
  const more =
    similar.length > 0
      ? similar
      : await nearbyTitles(row, audienceRules(viewer.audience), 12);
  const currentEpisode = progress?.episodeId
    ? ((await listEpisodes(row.id, null)).find(
        (episode) => episode.id === progress.episodeId,
      ) ?? null)
    : null;
  const play = playState(title, progress, currentEpisode);
  const language = languageName(title.originalLanguage);
  const directors = title.directors ?? [];
  const keywords = title.keywords ?? [];
  const cast = title.cast.map((person) => ({
    label: person.name,
    href: actorHref(person.name),
  }));
  const genres = title.genres.map((genre) => ({
    label: genre,
    href: `/browse?genres=${encodeURIComponent(genre)}`,
  }));
  const themes = keywords.map((keyword) => ({
    label: keyword,
    href: `/browse?keyword=${encodeURIComponent(keyword)}`,
  }));
  const people = directors.map((name) => ({
    label: name,
    href: actorHref(name),
  }));
  const pad = variant === "modal" ? "px-[5%]" : "px-[5%] md:px-12";

  return (
    <article>
      <TitleHero title={title} playHref={play.href} playLabel={play.label} />
      <div className={`space-y-12 pt-4 pb-12 ${pad}`}>
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-10">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-paper/80">
              <RatingValue value={title.rating} />
              {titleYears(title) ? <span>{titleYears(title)}</span> : null}
              {scale(title) ? <span>{scale(title)}</span> : null}
              <MaturityBadge value={title.certification} />
            </div>
            {progress && !progress.completed ? (
              <div className="space-y-1.5">
                {play.note.length > 0 ? (
                  <Dotted
                    items={play.note}
                    className="text-sm font-bold [&>span]:truncate"
                  />
                ) : null}
                <ProgressBar
                  share={progressShare(progress)}
                  className="max-w-sm rounded-full"
                />
              </div>
            ) : null}
            {title.tagline ? (
              <p className="font-bold text-paper/90">{title.tagline}</p>
            ) : null}
            <p className="leading-relaxed text-paper/90 md:text-lg">
              {title.overview ??
                "We don't have a description for this one yet."}
            </p>
          </div>
          <div className="min-w-0 space-y-3">
            {cast.length > 0 ? (
              <Fact label="Cast">
                <LinkList items={cast.slice(0, 3)} />
                {cast.length > 3 ? (
                  <>
                    {", "}
                    <a
                      href="#about"
                      data-nav
                      className="rounded text-paper/90 hover:underline"
                    >
                      more
                    </a>
                  </>
                ) : null}
              </Fact>
            ) : null}
            {genres.length > 0 ? (
              <Fact label="Genres">
                <LinkList items={genres} />
              </Fact>
            ) : null}
            {themes.length > 0 ? (
              <Fact
                label={
                  title.type === "movie" ? "This film is" : "This series is"
                }
              >
                <LinkList items={themes.slice(0, 3)} />
              </Fact>
            ) : null}
          </div>
        </div>

        {title.type !== "movie" && title.seasons.length > 0 ? (
          <Episodes
            seriesId={title.id}
            seasons={title.seasons}
            initialSeason={currentEpisode?.season ?? title.seasons[0]}
            currentEpisodeId={progress?.episodeId ?? null}
            completed={progress?.completed ?? false}
          />
        ) : null}

        {more.length > 0 ? (
          <section className="space-y-4" aria-labelledby="similar-heading">
            <h3 id="similar-heading" className="text-2xl font-bold">
              More like this
            </h3>
            <ul
              className={`grid gap-3 sm:gap-4 ${variant === "modal" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"}`}
            >
              {more.map((item) => (
                <li key={item.id} className="min-w-0">
                  <SimilarCard title={item} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          id="about"
          aria-labelledby="about-heading"
          className="scroll-mt-24 space-y-3"
        >
          <h3 id="about-heading" className="text-2xl">
            About <span className="font-bold">{title.title}</span>
          </h3>
          {people.length > 0 ? (
            <Fact label={title.type === "movie" ? "Director" : "Creators"}>
              <LinkList items={people} />
            </Fact>
          ) : null}
          {cast.length > 0 ? (
            <Fact label="Cast">
              <LinkList items={cast} />
            </Fact>
          ) : null}
          {genres.length > 0 ? (
            <Fact label="Genres">
              <LinkList items={genres} />
            </Fact>
          ) : null}
          {themes.length > 0 ? (
            <Fact
              label={title.type === "movie" ? "This film is" : "This series is"}
            >
              <LinkList items={themes.slice(0, 12)} />
            </Fact>
          ) : null}
          {title.originalTitle && title.originalTitle !== title.title ? (
            <Fact label="Original title">{title.originalTitle}</Fact>
          ) : null}
          {language ? <Fact label="Language">{language}</Fact> : null}
          {title.rating ? (
            <Fact label="IMDb rating">
              {title.rating.toFixed(1)} from {title.votes.toLocaleString()}{" "}
              votes
            </Fact>
          ) : null}
          {title.certification ? (
            <Fact label="Maturity rating">
              <MaturityBadge value={title.certification} />
            </Fact>
          ) : null}
        </section>
      </div>
    </article>
  );
}

export function TitleDetailsSkeleton() {
  return (
    <div aria-hidden>
      <div className="aspect-[4/3] w-full animate-pulse bg-lift sm:aspect-video" />
      <div className="grid gap-6 px-[5%] pt-6 pb-12 md:grid-cols-[2fr_1fr] md:gap-10">
        <div className="space-y-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-lift" />
          <div className="h-4 w-full animate-pulse rounded bg-lift" />
          <div className="h-4 w-full animate-pulse rounded bg-lift" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-lift" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-5/6 animate-pulse rounded bg-lift" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-lift" />
        </div>
      </div>
    </div>
  );
}
