import { type TitleSummary, titleYears } from "@repo/schemas/stream";
import Link from "next/link";

import { PosterImage } from "@/components/poster";

const TYPE_LABEL = { movie: "Film", series: "Series", miniseries: "Series" };

export function TitleRow({
  title,
  note,
}: {
  title: TitleSummary;
  note?: string;
}) {
  return (
    <li>
      <Link
        href={`/title/${title.id}`}
        data-nav
        className="grid grid-cols-[5.5rem_1fr] items-center gap-6 rounded-xl p-3 transition-colors hover:bg-raised"
      >
        <PosterImage title={title} sizes="88px" />
        <span className="space-y-1.5">
          <span className="block text-2xl leading-snug font-semibold">
            {title.title}
          </span>
          <span className="block text-lg text-muted">
            {TYPE_LABEL[title.type]}, {titleYears(title)}
            {title.rating ? `, rated ${title.rating.toFixed(1)} out of 10` : ""}
          </span>
          {note ? (
            <span className="block text-lg text-paper/80">{note}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
