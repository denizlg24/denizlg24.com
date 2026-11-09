import type { Metadata } from "next";
import Link from "next/link";

import { PosterTile } from "@/components/browse/tiles";
import { EmptyState, GridPage } from "@/components/grid/grid-page";
import { listWatchlist } from "@/lib/catalog";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "My List" };

export default async function MyListPage() {
  const viewer = await requireViewer("/my-list");
  const saved = await listWatchlist(viewer.audience[0].id);
  return (
    <GridPage heading="My List">
      {saved.length === 0 ? (
        <EmptyState
          title="Your list is empty"
          body="When you spot something you'd like to watch later, press the plus button on it and it will wait for you here."
          action={
            <Link
              href="/"
              data-nav
              data-nav-autofocus
              className="inline-block rounded-[4px] bg-paper px-6 py-3 font-bold text-ink"
            >
              Find something to watch
            </Link>
          }
        />
      ) : (
        <div className="title-grid">
          <ul>
            {saved.map((title) => (
              <li key={title.id} className="min-w-0">
                <PosterTile title={title} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </GridPage>
  );
}
