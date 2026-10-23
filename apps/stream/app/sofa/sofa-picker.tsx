"use client";

import type { Profile } from "@repo/schemas/stream";
import { Check, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { sitDown } from "@/app/actions";
import { joinNames, ProfileDisc } from "@/components/profile-disc";
import { Wordmark } from "@/components/top-bar";

/**
 * Several people can sit down together; their picks are blended. A profile
 * that prefers the classic layout gets a single-choice sofa — tapping a
 * new face starts straight away. Selected faces always toggle off, including
 * classic profiles that are already watching with other people.
 */
export function SofaPicker({
  profiles,
  initial,
  next,
}: {
  profiles: Profile[];
  initial: string[];
  next: string;
}) {
  const [chosen, setChosen] = useState<string[]>(initial);
  const [pending, startTransition] = useTransition();
  const people = profiles.filter((profile) => chosen.includes(profile.id));

  const start = (ids: string[]) =>
    startTransition(async () => {
      await sitDown(ids, next);
    });

  const tap = (profile: Profile) => {
    if (profile.layout === "classic" && !chosen.includes(profile.id)) {
      start([profile.id]);
      return;
    }
    setChosen((current) =>
      current.includes(profile.id)
        ? current.filter((id) => id !== profile.id)
        : [...current, profile.id],
    );
  };

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden px-6 py-10 md:px-16">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_100%,rgba(242,181,74,0.10),transparent_70%)]"
      />
      <header className="relative flex items-center justify-between">
        <Wordmark />
        <Link
          href="/profiles"
          data-nav
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted transition-colors hover:text-paper"
        >
          <Settings2 className="size-4" /> Manage profiles
        </Link>
      </header>
      <section className="relative flex flex-1 flex-col items-center justify-center gap-16 py-16">
        <div className="space-y-3 text-center animate-rise">
          <h1 className="font-display text-6xl md:text-8xl">
            Who's on the sofa?
          </h1>
          <p className="text-lg text-muted">
            Choose everyone who's watching — picks are made for all of you.
          </p>
        </div>
        <ul className="flex flex-wrap justify-center gap-10 md:gap-14">
          {profiles.map((profile, index) => {
            const on = chosen.includes(profile.id);
            return (
              <li
                key={profile.id}
                className="animate-rise"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <button
                  type="button"
                  data-nav
                  data-nav-autofocus={index === 0 ? "" : undefined}
                  aria-pressed={on}
                  onClick={() => tap(profile)}
                  className="group flex flex-col items-center gap-4 rounded-2xl p-2"
                >
                  <span className="relative">
                    <ProfileDisc
                      name={profile.name}
                      color={profile.color}
                      size="lg"
                      className={`transition duration-300 ${on ? "scale-105" : "opacity-55 saturate-50 group-hover:opacity-90 group-focus-visible:opacity-90"}`}
                    />
                    {on ? (
                      <span className="absolute -right-1 -bottom-1 grid size-9 place-items-center rounded-full bg-paper text-ink ring-4 ring-ink">
                        <Check className="size-5" strokeWidth={2.5} />
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`text-xl ${on ? "text-paper" : "text-muted"}`}
                  >
                    {profile.name}
                  </span>
                  {profile.kids ? (
                    <span className="-mt-3 rounded-full bg-paper/10 px-2.5 py-0.5 text-xs font-bold text-paper/70">
                      Kids
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {profiles.length < 5 ? (
            <li>
              <Link
                href="/profiles?new=1"
                data-nav
                className="group flex flex-col items-center gap-4 rounded-2xl p-2"
              >
                <span className="grid size-28 place-items-center rounded-full border border-dashed border-faint text-faint transition-colors group-hover:border-paper group-hover:text-paper md:size-36">
                  <Plus className="size-10" strokeWidth={1.25} />
                </span>
                <span className="text-xl text-muted">Add someone</span>
              </Link>
            </li>
          ) : null}
        </ul>
        <div className="flex h-16 items-center">
          {people.length > 0 ? (
            <button
              type="button"
              data-nav
              disabled={pending}
              onClick={() => start(chosen)}
              className="rounded-full bg-amber px-10 py-4 text-lg font-medium text-ink transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              {pending
                ? "Getting tonight ready…"
                : people.length === 1
                  ? `Start as ${people[0].name}`
                  : `Start — ${joinNames(people.map((p) => p.name))}`}
            </button>
          ) : (
            <p className="text-muted">Tap a face to sit down.</p>
          )}
        </div>
      </section>
    </main>
  );
}
