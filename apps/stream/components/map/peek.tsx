"use client";

import { type MapPoint, tmdbImage } from "@repo/schemas/stream";
import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { type Ref, useEffect, useRef, useState } from "react";
import { Rating } from "@/components/rating";

import { pointForTitle } from "./use-map-data";

export interface PeekTarget {
  id: string;
  x: number;
  y: number;
  point: MapPoint | null;
}

export const PEEK_WIDTH = 320;

export function Peek({
  target,
  picked,
  onClose,
  ref,
}: {
  target: PeekTarget;
  picked: boolean;
  onClose: () => void;
  ref: Ref<HTMLDivElement>;
}) {
  const [fetched, setFetched] = useState<MapPoint | null>(null);
  const detailsRef = useRef<HTMLAnchorElement>(null);
  const point = target.point ?? (fetched?.id === target.id ? fetched : null);

  useEffect(() => {
    if (target.point) return;
    const controller = new AbortController();
    pointForTitle(target.id, target, controller.signal).then(
      setFetched,
      () => {},
    );
    return () => controller.abort();
  }, [target]);

  useEffect(() => {
    detailsRef.current?.focus({ preventScroll: true });
  }, [target.id]);

  const poster = point ? tmdbImage(point.posterPath, "w342") : null;
  const meta = [
    point?.year ? String(point.year) : null,
    point ? (point.type === "movie" ? "Film" : "Series") : null,
  ].filter((part) => part !== null);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={point?.title ?? "Title"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed inset-x-0 bottom-0 z-40 animate-rise border-hairline border-t bg-raised/95 px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-md sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-0 sm:w-80 sm:translate-x-(--px) sm:translate-y-(--py) sm:rounded-lg sm:border-t-0 sm:p-4 sm:ring-1 sm:ring-hairline"
    >
      <div className="flex gap-4">
        <div className="w-24 shrink-0">
          {poster ? (
            <img
              src={poster}
              alt=""
              className="aspect-[2/3] w-full rounded-[4px] bg-lift object-cover ring-1 ring-hairline ring-inset"
            />
          ) : (
            <div className="flex aspect-[2/3] items-end rounded-[4px] bg-lift p-2 font-display text-muted text-sm leading-tight ring-1 ring-hairline ring-inset">
              {point?.title ?? ""}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 font-display text-3xl text-paper leading-none">
              {point?.title ?? (
                <span className="inline-block h-6 w-32 animate-pulse rounded bg-lift" />
              )}
            </h2>
            <button
              type="button"
              onClick={onClose}
              data-nav
              aria-label="Close"
              className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-paper"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          {meta.length > 0 ? (
            <div className="mt-1.5 flex items-center gap-3 text-paper/60 text-sm">
              <Rating value={point?.rating ?? null} className="font-bold" />
              {meta.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </div>
          ) : null}
          {picked ? (
            <div className="mt-2 flex items-center gap-1.5 font-bold text-amber text-sm">
              <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
              Picked for you
            </div>
          ) : null}
          <Link
            ref={detailsRef}
            href={`/title/${target.id}`}
            data-nav
            className="mt-auto inline-flex w-fit items-center gap-1 rounded-md pt-3 text-paper text-sm underline decoration-hairline underline-offset-4 transition-colors hover:decoration-amber"
          >
            See details
          </Link>
        </div>
      </div>
    </div>
  );
}
