import { decodeActorName, titleQuerySchema } from "@repo/schemas/stream";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PosterLink } from "@/components/poster";
import { TopBar } from "@/components/top-bar";
import { audienceRules } from "@/lib/audience-rules";
import { queryTitles } from "@/lib/catalog";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export async function generateMetadata({
  params,
}: PageProps<"/actor/[name]">): Promise<Metadata> {
  return { title: decodeActorName((await params).name) };
}
export default async function ActorPage({
  params,
  searchParams,
}: PageProps<"/actor/[name]">) {
  const name = decodeActorName((await params).name);
  const query = await searchParams;
  if (!name.trim() || name.length > 200) notFound();
  const viewer = await requireViewer(`/actor/${encodeURIComponent(name)}`);
  const cursor = Math.max(0, Math.min(100_000, Number(query.cursor) || 0));
  const page = await queryTitles(
    titleQuerySchema.parse({
      actor: name,
      cursor: Math.floor(cursor),
      limit: 48,
      sort: "newest",
    }),
    audienceRules(viewer.audience),
  );
  return (
    <div className="min-h-dvh">
      <TopBar audience={audienceProfiles(viewer)} layout={viewer.layout} />
      <main className="mx-auto max-w-[1600px] space-y-10 px-5 py-12 md:px-10">
        <div className="space-y-3">
          <h1 className="font-display text-6xl">{name}</h1>
          <p className="text-muted">
            {page.total} films and series in the catalogue
          </p>
        </div>
        {page.total ? (
          <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {page.titles.map((title) => (
              <li key={title.id}>
                <PosterLink title={title} />
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No matching titles yet. More appear as the catalogue is enriched.
          </p>
        )}
        <nav aria-label="Filmography pages" className="flex gap-6">
          {cursor > 0 ? (
            <Link
              data-nav
              href={`/actor/${encodeURIComponent(name)}?cursor=${Math.max(0, cursor - 48)}`}
            >
              Previous
            </Link>
          ) : null}
          {page.nextCursor !== null ? (
            <Link
              data-nav
              href={`/actor/${encodeURIComponent(name)}?cursor=${page.nextCursor}`}
            >
              Next
            </Link>
          ) : null}
        </nav>
      </main>
    </div>
  );
}
