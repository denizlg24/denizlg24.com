"use client";

import type { TitlePage, TitleSummary } from "@repo/schemas/stream";
import { useEffect, useRef, useState } from "react";

import { moreTitles } from "@/app/actions";
import { PosterTile } from "@/components/browse/tiles";

export function GridSkeleton({ count = 21 }: { count?: number }) {
  return (
    <div aria-hidden className="title-grid">
      <ul>
        {Array.from({ length: count }, (_, index) => (
          <li
            key={index}
            className="aspect-[2/3] animate-pulse rounded-[4px] bg-raised"
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Poster grid that keeps loading as you scroll. `query` is the
 * `titleQuerySchema` input the first page came from.
 */
export function TitleGrid({
  initial,
  query,
}: {
  initial: TitlePage;
  query: Record<string, string>;
}) {
  const [titles, setTitles] = useState<TitleSummary[]>(initial.titles);
  const [cursor, setCursor] = useState<number | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    void queryKey;
    setTitles(initial.titles);
    setCursor(initial.nextCursor);
    setFailed(false);
  }, [initial, queryKey]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || cursor === null || loading || failed) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        setLoading(true);
        moreTitles({ ...JSON.parse(queryKey), cursor })
          .then((page) => {
            setTitles((current) => {
              const seen = new Set(current.map((title) => title.id));
              return [
                ...current,
                ...page.titles.filter((title) => !seen.has(title.id)),
              ];
            });
            setCursor(page.nextCursor);
          })
          .catch(() => setFailed(true))
          .finally(() => setLoading(false));
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [cursor, loading, failed, queryKey]);

  return (
    <div className="space-y-8">
      <div className="title-grid">
        <ul>
          {titles.map((title) => (
            <li key={title.id} className="min-w-0">
              <PosterTile title={title} />
            </li>
          ))}
          {loading
            ? Array.from({ length: 7 }, (_, index) => (
                <li
                  key={`loading-${index}`}
                  aria-hidden
                  className="aspect-[2/3] animate-pulse rounded-[4px] bg-raised"
                />
              ))
            : null}
        </ul>
      </div>
      {failed ? (
        <div className="flex justify-center">
          <button
            type="button"
            data-nav
            onClick={() => setFailed(false)}
            className="rounded-[4px] border border-paper/40 px-5 py-2.5 hover:bg-paper/10"
          >
            Couldn't load more. Try again
          </button>
        </div>
      ) : null}
      <div ref={sentinel} aria-hidden className="h-px" />
    </div>
  );
}
