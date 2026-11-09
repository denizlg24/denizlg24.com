import type { Browse, BrowseRow } from "@repo/schemas/stream";
import { Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Billboard } from "@/components/browse/billboard";
import { Row } from "@/components/browse/row";
import {
  ContinueTile,
  PosterTile,
  RankTile,
  WideTile,
} from "@/components/browse/tiles";

function moreHref(row: Extract<BrowseRow, { kind: "titles" }>): string | null {
  if (!row.more) return null;
  const params = new URLSearchParams(row.more);
  params.set("label", row.label);
  return `/browse?${params.toString()}`;
}

function RowView({ row }: { row: BrowseRow }) {
  if (row.items.length === 0) return null;
  switch (row.kind) {
    case "continue":
      return (
        <Row label={row.label}>
          {row.items.map((item) => (
            <li key={item.title.id} className="tile tile-wide">
              <ContinueTile item={item} />
            </li>
          ))}
        </Row>
      );
    case "top10":
      return (
        <Row label={row.label}>
          {row.items.map((title, index) => (
            <li key={title.id} className="tile tile-wide">
              <RankTile title={title} rank={index + 1} />
            </li>
          ))}
        </Row>
      );
    case "titles":
      return (
        <Row label={row.label} more={moreHref(row)}>
          {row.items.map((title) =>
            row.wide ? (
              <li key={title.id} className="tile tile-wide">
                <WideTile title={title} />
              </li>
            ) : (
              <li key={title.id} className="tile tile-poster">
                <PosterTile title={title} />
              </li>
            ),
          )}
        </Row>
      );
  }
}

/** Billboard over rows: the shape of Home, Series, Films and New & Popular. */
export function BrowseView({
  browse,
  heading,
  empty,
}: {
  browse: Browse;
  heading?: ReactNode;
  empty: { title: string; body: string };
}) {
  const rows = browse.rows.filter((row) => row.items.length > 0);
  if (!browse.billboard && rows.length === 0) {
    return (
      <div className="px-[var(--gutter)] pt-28 pb-20">
        {heading}
        <div className="mx-auto mt-16 max-w-md space-y-4 text-center">
          <h2 className="font-display text-4xl">{empty.title}</h2>
          <p className="text-paper/70">{empty.body}</p>
          <Link
            href="/search"
            data-nav
            className="inline-flex items-center gap-2 rounded-[4px] bg-paper px-6 py-3 font-bold text-ink"
          >
            <Search className="size-5" aria-hidden />
            Search instead
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="pb-20">
      <div className="relative">
        {heading ? (
          <div className="relative z-10 px-[var(--gutter)] pt-[4.5rem] pb-3 md:absolute md:inset-x-0 md:top-[4.25rem] md:pt-3 md:pb-0">
            {heading}
          </div>
        ) : null}
        {browse.billboard ? (
          <Billboard billboard={browse.billboard} />
        ) : (
          <div className={heading ? "md:h-28" : "h-28"} />
        )}
      </div>
      <div
        className={`relative z-10 space-y-8 md:space-y-12 ${browse.billboard ? "lg:-mt-[9vw]" : ""}`}
      >
        {rows.map((row) => (
          <RowView key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

export function BrowseSkeleton({ heading }: { heading?: ReactNode }) {
  return (
    <div aria-hidden className="pb-20">
      {heading ? (
        <div className="relative z-10 px-[var(--gutter)] pt-[4.5rem] pb-3 md:absolute md:inset-x-0 md:top-[4.25rem] md:pt-3 md:pb-0">
          {heading}
        </div>
      ) : null}
      <div className="relative h-[min(150vw,82svh)] min-h-[26rem] w-full bg-raised md:h-[min(56.25vw,92svh)] md:min-h-[32rem]">
        <div className="absolute inset-x-[var(--gutter)] bottom-8 flex flex-col items-center gap-4 md:right-auto md:bottom-[16%] md:w-[min(45%,38rem)] lg:bottom-[30%] lg:w-[min(40%,38rem)] md:items-start">
          <div className="h-[clamp(4rem,9vw,8rem)] w-3/4 animate-pulse rounded bg-lift" />
          <div className="hidden h-4 w-full animate-pulse rounded bg-lift md:block" />
          <div className="hidden h-4 w-5/6 animate-pulse rounded bg-lift md:block" />
          <div className="flex w-full justify-center gap-3 md:justify-start">
            <div className="h-11 w-32 animate-pulse rounded-[4px] bg-lift md:h-12" />
            <div className="h-11 w-40 animate-pulse rounded-[4px] bg-lift md:h-12" />
          </div>
        </div>
      </div>
      <div className="relative z-10 space-y-8 lg:-mt-[9vw] md:space-y-12">
        {[0, 1, 2].map((row) => (
          <div key={row}>
            <div className="mx-[var(--gutter)] mb-3 h-5 w-48 animate-pulse rounded bg-raised" />
            <div className="row-scroller">
              {Array.from({ length: 9 }, (_, index) => (
                <div
                  key={index}
                  className={`tile ${row === 0 ? "tile-wide aspect-video" : "tile-poster aspect-[2/3]"} animate-pulse rounded-[4px] bg-raised`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
