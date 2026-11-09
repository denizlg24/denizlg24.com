import type { BrowseTab } from "@repo/schemas/stream";

import { BrowseView } from "@/components/browse/browse-view";
import { GenreMenu } from "@/components/browse/genre-menu";
import { buildBrowse } from "@/lib/browse";
import { requireViewer } from "@/lib/viewer";

const PATHS: Record<BrowseTab, string> = {
  home: "/",
  series: "/series",
  films: "/films",
  new: "/new",
};

const EMPTY: Record<BrowseTab, { title: string; body: string }> = {
  home: {
    title: "Nothing to show just yet",
    body: "Stream is still filling its shelves. Check back in a little while, or search for something you already have in mind.",
  },
  series: {
    title: "No series here yet",
    body: "Series appear here as the catalogue fills up. In the meantime, try searching for one by name.",
  },
  films: {
    title: "No films here yet",
    body: "Films appear here as the catalogue fills up. In the meantime, try searching for one by name.",
  },
  new: {
    title: "Nothing new right now",
    body: "New and popular titles show up here as they arrive. Check back soon.",
  },
};

export function TabHeading({ tab }: { tab: BrowseTab }) {
  if (tab !== "series" && tab !== "films") return null;
  return (
    <div className="flex min-w-0 items-center gap-4 md:gap-8">
      <h1 className="truncate text-[clamp(1.5rem,2.6vw,2.6rem)] font-bold">
        {tab === "series" ? "Series" : "Films"}
      </h1>
      <GenreMenu type={tab === "series" ? "series" : "movie"} />
    </div>
  );
}

export async function BrowsePage({ tab }: { tab: BrowseTab }) {
  const viewer = await requireViewer(PATHS[tab]);
  const browse = await buildBrowse(viewer.audience, tab);
  return (
    <BrowseView
      browse={browse}
      heading={<TabHeading tab={tab} />}
      empty={EMPTY[tab]}
    />
  );
}
