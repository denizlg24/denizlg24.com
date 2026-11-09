"use client";

import { MAX_PROFILES, type Profile } from "@repo/schemas/stream";
import { Check, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { chooseAudience } from "@/app/actions";
import { Wordmark } from "@/components/brand";
import { joinNames, ProfileDisc } from "@/components/profile-disc";

function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/**
 * Who's watching. A tap starts as that profile. "Watch together" turns the
 * faces into toggles so several people can sit down at once; their picks
 * and list are then shared, and the strictest settings apply.
 */
export function SofaPicker({
  profiles,
  initial,
  next,
  together: startTogether,
}: {
  profiles: Profile[];
  initial: string[];
  next: string;
  together: boolean;
}) {
  const [together, setTogether] = useState(startTogether || initial.length > 1);
  const [chosen, setChosen] = useState<string[]>(
    startTogether || initial.length > 1 ? initial : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const people = profiles.filter((profile) => chosen.includes(profile.id));

  const start = (ids: string[]) =>
    startTransition(async () => {
      const result = await chooseAudience(ids);
      if (result.ok) window.location.assign(safeNext(next));
      else setError(result.error);
    });

  const tap = (profile: Profile) => {
    if (!together) {
      setChosen([profile.id]);
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
    <main className="flex min-h-dvh flex-col px-[var(--gutter)] pt-[env(safe-area-inset-top)]">
      <header className="flex h-16 items-center md:h-[4.25rem]">
        <Wordmark className="text-[1.6rem] md:text-[2rem]" />
      </header>
      <section className="flex flex-1 flex-col items-center justify-center gap-[clamp(1.5rem,4vw,3rem)] py-10">
        <h1 className="text-center text-[clamp(2rem,3.5vw,3.5rem)] leading-tight font-medium">
          {together ? "Who's watching together?" : "Who's watching?"}
        </h1>
        <ul className="flex max-w-[64rem] flex-wrap justify-center gap-x-[clamp(1rem,2vw,2rem)] gap-y-6">
          {profiles.map((profile, index) => {
            const on = chosen.includes(profile.id);
            return (
              <li
                key={profile.id}
                className="animate-rise"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <button
                  type="button"
                  data-nav
                  data-nav-autofocus={index === 0 ? "" : undefined}
                  aria-pressed={together ? on : undefined}
                  disabled={pending}
                  onClick={() => tap(profile)}
                  className="group flex w-[clamp(5.5rem,11vw,10rem)] flex-col items-center gap-3 rounded-md outline-offset-4 disabled:cursor-wait"
                >
                  <span className="relative">
                    <ProfileDisc
                      name={profile.name}
                      color={profile.color}
                      size="lg"
                      className={`ring-paper transition duration-200 group-hover:ring-[3px] group-focus-visible:ring-[3px] ${together && !on ? "opacity-50 saturate-50" : ""} ${pending && on ? "animate-pulse" : ""}`}
                    />
                    {together && on ? (
                      <span className="absolute -right-2 -bottom-2 grid size-8 place-items-center rounded-full bg-paper text-ink ring-4 ring-ink">
                        <Check className="size-5" strokeWidth={3} />
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`max-w-full truncate text-[clamp(0.95rem,1.3vw,1.3rem)] transition-colors group-hover:text-paper group-focus-visible:text-paper ${on ? "text-paper" : "text-paper/55"}`}
                  >
                    {profile.name}
                  </span>
                  {profile.kids ? (
                    <span className="-mt-2 text-xs font-bold text-paper/50">
                      Kids
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {profiles.length < MAX_PROFILES && !together ? (
            <li>
              <Link
                href="/profiles?new=1"
                data-nav
                className="group flex w-[clamp(5.5rem,11vw,10rem)] flex-col items-center gap-3 rounded-md outline-offset-4"
              >
                <span className="grid size-[clamp(5.5rem,11vw,10rem)] place-items-center rounded-md text-paper/50 transition-colors group-hover:bg-paper/10 group-hover:text-paper">
                  <Plus className="size-1/2" strokeWidth={1.5} />
                </span>
                <span className="text-[clamp(0.95rem,1.3vw,1.3rem)] text-paper/55 group-hover:text-paper">
                  Add profile
                </span>
              </Link>
            </li>
          ) : null}
        </ul>

        {error ? (
          <p role="alert" className="text-ember">
            {error}
          </p>
        ) : null}

        <div className="flex min-h-14 flex-col items-center gap-4">
          {together ? (
            <>
              <button
                type="button"
                data-nav
                disabled={pending || people.length === 0}
                onClick={() => start(chosen)}
                className="max-w-[min(32rem,calc(100vw-2*var(--gutter)))] truncate rounded-[4px] bg-paper px-8 py-3 text-lg font-bold text-ink transition-colors hover:bg-paper/85 disabled:bg-paper/30 disabled:text-ink/70"
              >
                {pending
                  ? "Starting…"
                  : people.length === 0
                    ? "Choose who's watching"
                    : `Start watching: ${joinNames(people.map((p) => p.name))}`}
              </button>
              <button
                type="button"
                data-nav
                onClick={() => {
                  setTogether(false);
                  setChosen([]);
                }}
                className="rounded text-sm text-paper/60 hover:text-paper"
              >
                Just one person
              </button>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/profiles"
                data-nav
                className="border border-paper/50 px-6 py-2 text-paper/70 transition-colors hover:border-paper hover:text-paper md:text-lg"
              >
                Manage profiles
              </Link>
              {profiles.length > 1 ? (
                <button
                  type="button"
                  data-nav
                  onClick={() => setTogether(true)}
                  className="flex items-center gap-2 border border-paper/50 px-6 py-2 text-paper/70 transition-colors hover:border-paper hover:text-paper md:text-lg"
                >
                  <Users className="size-5" aria-hidden />
                  Watch together
                </button>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
