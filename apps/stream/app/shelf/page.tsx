import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PosterLink } from "@/components/poster";
import { TopBar } from "@/components/top-bar";
import { continueWatching, finishedTitles, listWatchlist } from "@/lib/catalog";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Shelf" };

const TABS = [
  { id: "watching", label: "In progress" },
  { id: "saved", label: "Saved" },
  { id: "finished", label: "Finished" },
] as const;

const EMPTY = {
  watching: "Anything you start watching waits for you here.",
  saved:
    "Save a title from Tonight, Tune or the Map and it lands on this shelf.",
  finished: "Titles you've watched to the end are kept here.",
};

export default async function ShelfPage({ searchParams }: PageProps<"/shelf">) {
  const viewer = await requireViewer("/shelf");
  if (viewer.layout === "classic") redirect("/my-list");
  const { tab: raw } = await searchParams;
  const tab = TABS.find((item) => item.id === raw)?.id ?? "watching";
  const profile = viewer.audience[0];
  const items =
    tab === "watching"
      ? (await continueWatching(profile.id, 120)).map((item) => ({
          title: item.title,
          progress:
            item.progress.durationS > 0
              ? item.progress.positionS / item.progress.durationS
              : 0,
        }))
      : (tab === "saved"
          ? await listWatchlist(profile.id)
          : await finishedTitles(profile.id)
        ).map((title) => ({ title, progress: undefined }));

  return (
    <div className="min-h-dvh">
      <TopBar audience={audienceProfiles(viewer)} layout="studio" />
      <main className="mx-auto max-w-[1600px] space-y-10 px-5 py-10 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-2">
            <h1 className="font-display text-6xl">Shelf</h1>
            {viewer.audience.length > 1 ? (
              <p className="text-muted">Showing {profile.name}'s shelf.</p>
            ) : null}
          </div>
          <nav aria-label="Shelf" className="flex gap-2">
            {TABS.map((item) => (
              <Link
                key={item.id}
                href={`/shelf?tab=${item.id}`}
                data-nav
                aria-current={tab === item.id ? "page" : undefined}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${tab === item.id ? "bg-paper text-ink" : "text-muted ring-1 ring-hairline hover:text-paper"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        {items.length === 0 ? (
          <p className="max-w-md py-20 text-2xl leading-snug text-paper/60">
            {EMPTY[tab]}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-7">
            {items.map((item) => (
              <li key={item.title.id}>
                <PosterLink title={item.title} progress={item.progress} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
