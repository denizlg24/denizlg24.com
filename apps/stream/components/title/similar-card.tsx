"use client";

import type { TitleSummary } from "@repo/schemas/stream";
import Link from "next/link";

import { WideArt } from "@/components/browse/tiles";
import { MyListButton } from "@/components/my-list";
import {
  Dotted,
  MaturityBadge,
  RatingValue,
  summaryFacts,
} from "@/components/title/meta";

/** A "More like this" card: still, facts and the My List button. */
export function SimilarCard({ title }: { title: TitleSummary }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[4px] bg-lift">
      <Link
        href={`/title/${title.id}`}
        data-nav
        aria-label={title.title}
        className="block rounded-[4px] outline-offset-[-3px]"
      >
        <WideArt
          title={title}
          sizes="(min-width: 900px) 17rem, (min-width: 640px) 30vw, 46vw"
        />
      </Link>
      <div className="flex flex-1 items-start justify-between gap-3 p-3 text-sm">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate font-bold">{title.title}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-paper/75">
            <RatingValue value={title.rating} />
            <MaturityBadge value={title.certification} />
            <Dotted items={summaryFacts(title)} />
          </div>
        </div>
        <MyListButton titleId={title.id} size="sm" />
      </div>
    </div>
  );
}
