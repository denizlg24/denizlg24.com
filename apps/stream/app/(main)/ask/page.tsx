import {
  ASSISTANT_PROMPT_MAX,
  assistantPromptSchema,
} from "@repo/schemas/stream";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PosterTile } from "@/components/browse/tiles";
import { GridSkeleton } from "@/components/grid/title-grid";
import type { ProfileRow } from "@/db/schema";
import { askAssistant } from "@/lib/assistant";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Ask for ideas" };

const IDEAS = [
  "Something funny and short for tonight",
  "A gripping thriller like Gone Girl",
  "A feel-good film we can all watch together",
  "A mind-bending sci-fi series",
  "A classic from the 80s",
  "A slow, beautiful drama",
];

const KIDS_IDEAS = [
  "An animated adventure for the kids",
  "Something funny the whole family will enjoy",
  "A film about animals",
  "A magical fantasy adventure",
];

async function Answer({
  profiles,
  prompt,
}: {
  profiles: ProfileRow[];
  prompt: string;
}) {
  const result = await askAssistant(profiles, prompt);
  if (result.picks.length === 0) {
    return (
      <div className="space-y-2 py-10">
        <p className="text-2xl font-bold">Nothing fits that yet</p>
        <p className="text-paper/70">
          Try asking another way, or with fewer details.
        </p>
      </div>
    );
  }
  return (
    <section aria-label={`Ideas for: ${result.prompt}`} className="space-y-6">
      {result.personal ? null : (
        <p className="text-paper/70">
          These are the closest matches in the catalogue.
        </p>
      )}
      <div className="title-grid">
        <ul>
          {result.picks.map((pick) => (
            <li key={pick.title.id} className="min-w-0 space-y-2">
              <PosterTile title={pick.title} />
              <p className="line-clamp-3 text-sm leading-snug text-paper/70">
                {pick.reason}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Thinking() {
  return (
    <div className="space-y-6" role="status">
      <p className="flex items-center gap-3 text-paper/70">
        <Sparkles className="size-5 animate-pulse text-amber" aria-hidden />
        Looking through the catalogue for you…
      </p>
      <GridSkeleton count={14} />
    </div>
  );
}

export default async function AskPage({ searchParams }: PageProps<"/ask">) {
  const viewer = await requireViewer("/ask");
  const params = await searchParams;
  const parsed = assistantPromptSchema.safeParse(
    typeof params.q === "string" ? params.q : "",
  );
  const prompt = parsed.success ? parsed.data : "";
  const kids = viewer.audience.some((profile) => profile.kids);

  return (
    <div className="space-y-10 px-[var(--gutter)] pt-24 pb-20 md:pt-28">
      <div className="max-w-3xl space-y-6">
        <h1 className="text-[clamp(1.75rem,3vw,3rem)] leading-tight font-bold">
          What do you feel like watching?
        </h1>
        <form
          action="/ask"
          className="flex min-w-0 items-center gap-3 border border-paper/40 bg-ink px-4 py-2 focus-within:border-amber"
        >
          <Sparkles className="size-5 shrink-0 text-amber" aria-hidden />
          <label className="min-w-0 flex-1">
            <span className="sr-only">Describe what you'd like to watch</span>
            <input
              name="q"
              defaultValue={prompt}
              maxLength={ASSISTANT_PROMPT_MAX}
              autoComplete="off"
              data-nav-autofocus={prompt ? undefined : ""}
              data-nav
              placeholder="A cosy mystery, a 90s action film…"
              className="h-10 w-full min-w-0 bg-transparent text-lg outline-none placeholder:text-paper/40"
            />
          </label>
          <button
            type="submit"
            data-nav
            className="shrink-0 rounded-[4px] bg-paper px-5 py-2 font-bold text-ink"
          >
            Ask
          </button>
        </form>
        {prompt ? null : (
          <ul className="flex flex-wrap gap-2">
            {(kids ? KIDS_IDEAS : IDEAS).map((idea) => (
              <li key={idea} className="min-w-0">
                <Link
                  href={`/ask?q=${encodeURIComponent(idea)}`}
                  data-nav
                  className="block max-w-full truncate rounded-full border border-paper/25 px-4 py-2 text-sm text-paper/80 transition-colors hover:border-paper/60 hover:text-paper"
                >
                  {idea}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {prompt ? (
        <Suspense key={prompt} fallback={<Thinking />}>
          <Answer profiles={viewer.audience} prompt={prompt} />
        </Suspense>
      ) : null}
    </div>
  );
}
