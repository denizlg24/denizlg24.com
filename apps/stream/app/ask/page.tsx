import {
  ASSISTANT_PROMPT_MAX,
  assistantPromptSchema,
} from "@repo/schemas/stream";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PosterLink } from "@/components/poster";
import { TopBar } from "@/components/top-bar";
import type { ProfileRow } from "@/db/schema";
import { askAssistant } from "@/lib/assistant";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Ask" };

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

const GRID =
  "grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

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
        <p className="text-3xl font-semibold">Nothing fits that yet</p>
        <p className="text-xl text-muted">
          Try asking another way, or with fewer details.
        </p>
      </div>
    );
  }
  return (
    <section aria-label={`Ideas for: ${result.prompt}`} className="space-y-6">
      {result.personal ? null : (
        <p className="text-muted">
          These are the closest matches in the catalogue.
        </p>
      )}
      <ul className={GRID}>
        {result.picks.map((pick) => (
          <li key={pick.title.id} className="space-y-2">
            <PosterLink title={pick.title} />
            <p className="line-clamp-3 text-sm leading-snug text-paper/70">
              {pick.reason}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Thinking() {
  return (
    <div className="space-y-6" role="status">
      <p className="flex items-center gap-3 text-xl text-muted">
        <Sparkles className="size-5 animate-pulse text-amber" aria-hidden />
        Looking through the catalogue for you…
      </p>
      <ul className={GRID} aria-hidden>
        {Array.from({ length: 12 }, (_, index) => (
          <li key={index} className="space-y-2.5">
            <div className="aspect-[2/3] animate-pulse rounded-[4px] bg-raised" />
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-raised" />
            <div className="h-3 w-full animate-pulse rounded bg-raised" />
          </li>
        ))}
      </ul>
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
    <div className="min-h-dvh">
      <TopBar audience={audienceProfiles(viewer)} layout={viewer.layout} />
      <main className="mx-auto max-w-[1600px] space-y-10 px-5 py-10 md:px-10">
        <div className="max-w-4xl space-y-6">
          <h1 className="text-4xl font-semibold md:text-5xl">
            What do you feel like watching?
          </h1>
          <form
            action="/ask"
            className="flex items-center gap-4 rounded-2xl bg-raised px-6 py-5 ring-2 ring-transparent focus-within:ring-amber"
          >
            <Sparkles className="size-7 shrink-0 text-amber" aria-hidden />
            <label className="flex-1">
              <span className="sr-only">Describe what you'd like to watch</span>
              <input
                name="q"
                defaultValue={prompt}
                maxLength={ASSISTANT_PROMPT_MAX}
                autoComplete="off"
                data-nav-autofocus={prompt ? undefined : ""}
                data-nav
                placeholder="A cosy mystery, a 90s action film, something like Paddington…"
                className="w-full bg-transparent text-xl outline-none placeholder:text-faint md:text-2xl"
              />
            </label>
            <button
              type="submit"
              data-nav
              className="rounded-xl bg-paper px-6 py-3 text-xl font-semibold text-ink"
            >
              Ask
            </button>
          </form>
          {prompt ? null : (
            <div className="flex flex-wrap gap-2.5">
              {(kids ? KIDS_IDEAS : IDEAS).map((idea) => (
                <Link
                  key={idea}
                  href={`/ask?q=${encodeURIComponent(idea)}`}
                  data-nav
                  className="rounded-full px-4 py-2 text-lg text-muted ring-1 ring-hairline transition-colors hover:text-paper"
                >
                  {idea}
                </Link>
              ))}
            </div>
          )}
        </div>
        {prompt ? (
          <Suspense key={prompt} fallback={<Thinking />}>
            <Answer profiles={viewer.audience} prompt={prompt} />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
