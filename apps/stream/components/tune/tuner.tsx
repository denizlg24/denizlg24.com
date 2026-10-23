"use client";

import {
  genreSchema,
  type TitlePage,
  type TitleSummary,
  titlePageSchema,
} from "@repo/schemas/stream";
import { RotateCcw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { PosterLink } from "@/components/poster";
import { Dial } from "@/components/tune/dial";
import {
  ACCLAIM,
  DECADES,
  DEFAULT_TUNE,
  KINDS,
  MOOD,
  queryString,
  SORTS,
  TIME,
  type TuneState,
  tuneToParams,
  tuneToQuery,
} from "@/lib/tune";

const PAGE = 48;

function withTransition(update: () => void) {
  if (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document.startViewTransition(() => flushSync(update));
  } else {
    update();
  }
}

export function Tuner({
  initial,
  profileId,
  focusSearch,
}: {
  initial: TuneState;
  profileId: string;
  focusSearch: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [titles, setTitles] = useState<TitleSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const searchField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSearch) searchField.current?.focus();
  }, [focusSearch]);

  const load = useCallback(
    async (tune: TuneState, cursor: number) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setFailed(false);
      try {
        const search = queryString({
          ...tuneToQuery(tune),
          cursor,
          limit: PAGE,
        });
        const response = await fetch(
          `/api/v1/titles?${search}&profile=${profileId}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(String(response.status));
        const page: TitlePage = titlePageSchema.parse(await response.json());
        withTransition(() => {
          setTitles((current) =>
            cursor === 0 ? page.titles : [...current, ...page.titles],
          );
          setTotal(page.total);
          setNext(page.nextCursor);
        });
        setLoading(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setFailed(true);
        setLoading(false);
      }
    },
    [profileId],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(state, 0);
      const params = tuneToParams(state).toString();
      router.replace(params ? `/tune?${params}` : "/tune", { scroll: false });
    }, 180);
    return () => clearTimeout(timer);
  }, [state, load, router]);

  const set = <K extends keyof TuneState>(key: K, value: TuneState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const tuned = JSON.stringify(state) !== JSON.stringify(DEFAULT_TUNE);
  const decadeLabels = DECADES.map((decade) => `’${String(decade).slice(2)}`);
  decadeLabels[decadeLabels.length - 1] = "now";

  return (
    <div className="mx-auto grid max-w-[1600px] gap-10 px-5 py-10 md:px-10 lg:grid-cols-[22rem_1fr] lg:gap-16">
      <aside className="space-y-9 lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-2">
          <h1 className="font-display text-6xl">Tune</h1>
          <p className="text-muted">
            Turn the dials until something feels right.
          </p>
        </div>
        <label className="flex items-center gap-3 border-b border-hairline pb-3 focus-within:border-amber">
          <Search className="size-5 text-muted" strokeWidth={1.75} />
          <span className="sr-only">Search by name</span>
          <input
            value={state.q}
            onChange={(event) => set("q", event.target.value)}
            placeholder="or name something…"
            ref={searchField}
            data-nav
            className="w-full bg-transparent font-display text-2xl outline-none placeholder:text-faint"
          />
        </label>
        <div role="radiogroup" aria-label="Kind" className="flex gap-2">
          {KINDS.map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={state.kind === option.value}
              data-nav
              onClick={() => set("kind", option.value)}
              className={`rounded-full px-4 py-2 text-sm transition-colors ${state.kind === option.value ? "bg-paper text-ink" : "text-muted ring-1 ring-hairline hover:text-paper"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <fieldset className="space-y-3">
          <legend className="mb-3 font-display text-2xl">Genres</legend>
          <p className="text-sm text-muted">
            Choose one or more. Matches include every selected genre.
          </p>
          <div className="flex flex-wrap gap-2">
            {genreSchema.options.map((genre) => (
              <button
                key={genre}
                type="button"
                data-nav
                aria-pressed={state.genres.includes(genre)}
                onClick={() =>
                  set(
                    "genres",
                    state.genres.includes(genre)
                      ? state.genres.filter((value) => value !== genre)
                      : [...state.genres, genre],
                  )
                }
                className={`rounded-full px-3 py-2 text-sm ring-1 transition-colors ${state.genres.includes(genre) ? "bg-amber text-ink ring-amber" : "text-muted ring-hairline hover:text-paper"}`}
              >
                {genre}
              </button>
            ))}
          </div>
        </fieldset>
        <Dial
          label={state.kind === "series" ? "Episode length" : "Time you have"}
          options={TIME.map((option) => option.label)}
          value={state.time}
          onChange={(index) => set("time", index)}
        />
        <Dial
          label="Mood"
          options={MOOD.map((option) => option.label)}
          value={state.mood}
          onChange={(index) => set("mood", index)}
        />
        <Dial
          label="Era"
          options={decadeLabels}
          value={state.eraFrom}
          onChange={(index) => set("eraFrom", index)}
          range={{
            value: state.eraTo,
            onChange: (index) => set("eraTo", index),
          }}
        />
        <Dial
          label="Acclaim"
          options={ACCLAIM.map((option) => option.label)}
          value={state.acclaim}
          onChange={(index) => set("acclaim", index)}
        />
        {tuned ? (
          <button
            type="button"
            data-nav
            onClick={() => setState(DEFAULT_TUNE)}
            className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-paper"
          >
            <RotateCcw className="size-4" /> Reset the dials
          </button>
        ) : null}
      </aside>

      <section
        aria-live="polite"
        aria-busy={loading}
        className="min-w-0 space-y-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
          <p className="font-display text-3xl">
            {total === null ? (
              <span className="text-faint">Tuning…</span>
            ) : (
              <>
                <span className="text-amber">{total.toLocaleString()}</span>{" "}
                {total === 1 ? "match" : "matches"}
              </>
            )}
          </p>
          <div className="flex gap-1">
            {SORTS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-nav
                aria-pressed={state.sort === option.value}
                onClick={() => set("sort", option.value)}
                className={`rounded-full px-3 py-1.5 text-xs tracking-wide transition-colors ${state.sort === option.value ? "text-paper ring-1 ring-paper/40" : "text-muted hover:text-paper"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {failed ? (
          <div className="space-y-4 py-16 text-center">
            <p className="font-display text-3xl">That didn't come through.</p>
            <button
              type="button"
              data-nav
              onClick={() => void load(state, 0)}
              className="rounded-full bg-paper px-6 py-3 text-ink"
            >
              Try again
            </button>
          </div>
        ) : total === 0 ? (
          <div className="space-y-3 py-16 text-center">
            <p className="font-display text-4xl">Nothing on this frequency.</p>
            <p className="text-muted">
              Loosen a dial or two and see what turns up.
            </p>
          </div>
        ) : (
          <ul
            className={`grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 ${loading ? "opacity-70" : ""} transition-opacity`}
          >
            {titles.map((title) => (
              <li
                key={title.id}
                style={{ viewTransitionName: `t-${title.id}` }}
              >
                <PosterLink title={title} />
              </li>
            ))}
          </ul>
        )}
        {next !== null && !failed ? (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              data-nav
              disabled={loading}
              onClick={() => void load(state, next)}
              className="rounded-full px-6 py-3 text-muted ring-1 ring-hairline transition-colors hover:text-paper disabled:opacity-50"
            >
              {loading ? "Loading…" : "Show more"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
