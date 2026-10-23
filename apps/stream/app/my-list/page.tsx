import type { Metadata } from "next";

import { TitleRow } from "@/components/classic/title-row";
import { TopBar } from "@/components/top-bar";
import { continueWatching, listWatchlist } from "@/lib/catalog";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "My list" };

function minutesLeft(positionS: number, durationS: number): string {
  const left = Math.max(0, Math.round((durationS - positionS) / 60));
  return left > 0 ? `${left} minutes left` : "Almost finished";
}

export default async function MyListPage() {
  const viewer = await requireViewer("/my-list");
  const profile = viewer.audience[0];
  const [watching, saved] = await Promise.all([
    continueWatching(profile.id, 30),
    listWatchlist(profile.id),
  ]);
  return (
    <div className="min-h-dvh">
      <TopBar audience={audienceProfiles(viewer)} layout={viewer.layout} />
      <main className="mx-auto max-w-4xl space-y-14 px-6 py-10">
        <h1 className="text-5xl font-semibold">My list</h1>
        {watching.length > 0 ? (
          <section className="space-y-4">
            <h2 className="text-3xl font-semibold">Continue watching</h2>
            <ul className="space-y-2">
              {watching.map((item) => (
                <TitleRow
                  key={item.title.id}
                  title={item.title}
                  note={minutesLeft(
                    item.progress.positionS,
                    item.progress.durationS,
                  )}
                />
              ))}
            </ul>
          </section>
        ) : null}
        <section className="space-y-4">
          <h2 className="text-3xl font-semibold">Saved for later</h2>
          {saved.length === 0 ? (
            <p className="text-xl leading-relaxed text-muted">
              Nothing saved yet. When you see something you'd like to watch,
              press <span className="text-paper">“Add to my list”</span> and it
              will appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {saved.map((title) => (
                <TitleRow key={title.id} title={title} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
