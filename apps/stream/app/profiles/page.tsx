import { desc, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProfilesView } from "@/app/profiles/profiles-view";
import { TvToggle } from "@/app/profiles/tv-toggle";
import { db } from "@/db";
import { ingestRuns, titles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { listMembers, listProfiles } from "@/lib/members";
import { isTv, requireMemberSession } from "@/lib/viewer";

export const metadata: Metadata = { title: "Profiles" };

async function catalogueStatus() {
  const [[counts], runs, members] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        enriched: sql<number>`count(${titles.enrichedAt})::int`,
        posters: sql<number>`count(${titles.posterPath})::int`,
      })
      .from(titles),
    db.select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(6),
    listMembers(),
  ]);
  return { counts, runs, members };
}

export default async function ProfilesPage({
  searchParams,
}: PageProps<"/profiles">) {
  const { member } = await requireMemberSession("/profiles");
  const [profiles, tv, params] = await Promise.all([
    listProfiles(member.subject),
    isTv(),
    searchParams,
  ]);
  const owner = member.role === "owner" ? await catalogueStatus() : null;

  return (
    <main className="mx-auto max-w-3xl space-y-14 px-6 py-10">
      <Link
        href="/sofa"
        data-nav
        className="inline-flex items-center gap-2 text-muted hover:text-paper"
      >
        <ArrowLeft className="size-4" /> Back to the sofa
      </Link>
      <section className="space-y-6">
        <div className="space-y-2">
          <h1 className="font-display text-6xl">Profiles</h1>
          <p className="text-muted">
            Everyone in your home can have their own profile, with their own
            list, history and recommendations.
          </p>
        </div>
        <ProfilesView profiles={profiles} startNew={params.new === "1"} />
      </section>
      <section className="space-y-4">
        <h2 className="font-display text-3xl">This screen</h2>
        <TvToggle tv={tv} />
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-3xl">Account</h2>
        <p className="text-muted">Signed in as {member.name}.</p>
        <a
          href={auth.logoutUrl("/sign-in")}
          data-nav
          className="inline-block rounded-full px-5 py-2.5 ring-1 ring-hairline hover:ring-paper/40"
        >
          Sign out
        </a>
      </section>
      {owner ? (
        <section className="space-y-4 border-t border-hairline pt-10">
          <h2 className="font-display text-3xl">Catalogue</h2>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-faint">titles</dt>
              <dd>{owner.counts.total.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-faint">enriched</dt>
              <dd>{owner.counts.enriched.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-faint">posters</dt>
              <dd>{owner.counts.posters.toLocaleString()}</dd>
            </div>
          </dl>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-hairline">
              {owner.runs.map((run) => (
                <tr key={run.id}>
                  <td className="py-2 text-muted">
                    {run.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td>{run.kind}</td>
                  <td
                    className={
                      run.status === "failed"
                        ? "text-ember"
                        : run.status === "running"
                          ? "text-amber"
                          : ""
                    }
                  >
                    {run.status}
                  </td>
                  <td className="text-muted">
                    {Object.entries(run.stats)
                      .map(([key, value]) => `${key} ${value}`)
                      .join(", ")}
                    {run.error ? ` — ${run.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted">
            {owner.members.length} members:{" "}
            {owner.members.map((row) => row.name).join(", ")}
          </p>
        </section>
      ) : null}
    </main>
  );
}
