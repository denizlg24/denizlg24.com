import { decodeActorName, titleQuerySchema } from "@repo/schemas/stream";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState, GridPage } from "@/components/grid/grid-page";
import { TitleGrid } from "@/components/grid/title-grid";
import { audienceRules } from "@/lib/audience-rules";
import { queryTitles } from "@/lib/catalog";
import { requireViewer } from "@/lib/viewer";

const PAGE = 42;

export async function generateMetadata({
  params,
}: PageProps<"/actor/[name]">): Promise<Metadata> {
  return { title: decodeActorName((await params).name) };
}

export default async function ActorPage({
  params,
}: PageProps<"/actor/[name]">) {
  const name = decodeActorName((await params).name);
  if (!name.trim() || name.length > 200) notFound();
  const viewer = await requireViewer(`/actor/${encodeURIComponent(name)}`);
  const query = { actor: name, sort: "newest", limit: String(PAGE) };
  const first = await queryTitles(
    titleQuerySchema.parse(query),
    audienceRules(viewer.audience),
  );
  return (
    <GridPage
      heading={name}
      note={
        first.total > 0
          ? `${first.total} ${first.total === 1 ? "title" : "titles"} on Stream`
          : null
      }
    >
      {first.titles.length === 0 ? (
        <EmptyState
          title="Nothing with them yet"
          body="Their films and series appear here as the catalogue fills up."
        />
      ) : (
        <TitleGrid initial={first} query={query} />
      )}
    </GridPage>
  );
}
