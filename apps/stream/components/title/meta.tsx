import {
  formatRuntime,
  type Progress,
  type TitleSummary,
  titleYears,
} from "@repo/schemas/stream";
import { Star } from "lucide-react";
import { Fragment, type ReactNode } from "react";

export const TYPE_LABEL = {
  movie: "Film",
  series: "Series",
  miniseries: "Limited series",
} as const;

export function MaturityBadge({
  value,
  className = "",
}: {
  value: string | null | undefined;
  className?: string;
}) {
  if (!value) return null;
  return (
    <span
      className={`inline-block shrink-0 border border-paper/45 px-1.5 text-[0.75em] leading-[1.5] whitespace-nowrap text-paper/85 ${className}`}
    >
      {value}
    </span>
  );
}

export function RatingValue({ value }: { value: number | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-bold text-amber">
      <Star className="size-[0.9em] fill-current" strokeWidth={0} aria-hidden />
      <span className="sr-only">Rated </span>
      {value.toFixed(1)}
      <span className="sr-only"> out of 10</span>
    </span>
  );
}

/** Small separator dots, drawn rather than typed. */
export function Dotted({
  items,
  className = "",
}: {
  items: ReactNode[];
  className?: string;
}) {
  return (
    <span
      className={`flex min-w-0 flex-wrap items-center gap-x-2 ${className}`}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span
              aria-hidden
              className="size-1 shrink-0 rounded-full bg-paper/40"
            />
          ) : null}
          <span className="whitespace-nowrap">{item}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** Year, then runtime for a film or the kind of series. */
export function summaryFacts(title: TitleSummary): string[] {
  return [
    titleYears(title),
    title.type === "movie"
      ? formatRuntime(title.runtimeMinutes)
      : TYPE_LABEL[title.type],
  ].filter((part) => part.length > 0);
}

export function MetaRow({
  title,
  className = "",
}: {
  title: TitleSummary;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 ${className}`}
    >
      <RatingValue value={title.rating} />
      <MaturityBadge value={title.certification} />
      {summaryFacts(title).map((fact) => (
        <span key={fact} className="whitespace-nowrap">
          {fact}
        </span>
      ))}
    </div>
  );
}

export function progressShare(progress: Progress): number {
  if (progress.durationS <= 0) return 0.05;
  return Math.min(1, Math.max(0.03, progress.positionS / progress.durationS));
}

export function timeLeft(progress: Progress): string | null {
  if (progress.durationS <= 0) return null;
  const minutes = Math.round((progress.durationS - progress.positionS) / 60);
  if (minutes <= 1) return "Almost done";
  return `${formatRuntime(minutes)} left`;
}

export function playHref(titleId: string, progress?: Progress | null): string {
  return progress?.episodeId && !progress.completed
    ? `/watch/${titleId}?episode=${progress.episodeId}`
    : `/watch/${titleId}`;
}

export function ProgressBar({
  share,
  className = "",
}: {
  share: number;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label="Watched so far"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      className={`h-[3px] overflow-hidden bg-paper/25 ${className}`}
    >
      <div className="h-full bg-amber" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

/** "S2:E4" for an episode in progress, or null for a film. */
export function episodeTag(
  episode: { season: number | null; episode: number | null } | null | undefined,
): string | null {
  if (!episode || episode.episode === null) return null;
  return episode.season === null
    ? `E${episode.episode}`
    : `S${episode.season}:E${episode.episode}`;
}
