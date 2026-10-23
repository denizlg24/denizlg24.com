"use client";

import type { ProfileColor } from "@repo/schemas/stream";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { setUp } from "@/app/actions";
import { ColorChoice } from "@/components/color-choice";
import { ProfileDisc } from "@/components/profile-disc";
import { Wordmark } from "@/components/top-bar";

export function WelcomeForm() {
  const router = useRouter();
  const focusOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ProfileColor>("ember");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await setUp({ name, color });
      if (result.ok) router.replace("/sofa");
      else setError(result.error);
    });
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-12 px-6 py-16">
      <Wordmark className="text-3xl" />
      <div className="space-y-4 animate-rise">
        <h1 className="font-display text-5xl leading-tight md:text-7xl">
          Welcome. What should we call you?
        </h1>
        <p className="max-w-lg text-lg text-muted">
          This is the name on your profile. You can add profiles for other
          people in your home later — each one keeps its own list and
          recommendations.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-10">
        <div className="flex items-center gap-6">
          <ProfileDisc name={name || "?"} color={color} size="md" />
          <label className="flex-1">
            <span className="sr-only">Your name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              ref={focusOnMount}
              data-nav
              placeholder="Your name"
              className="w-full border-b border-hairline bg-transparent pb-3 font-display text-4xl outline-none placeholder:text-faint focus:border-amber"
            />
          </label>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-muted">Pick a colour</p>
          <ColorChoice value={color} onChange={setColor} />
        </div>
        <div className="flex items-center gap-5">
          <button
            type="submit"
            disabled={pending || name.trim().length === 0}
            data-nav
            className="rounded-full bg-amber px-8 py-4 text-lg font-medium text-ink transition disabled:opacity-40"
          >
            {pending ? "Setting up…" : "Start watching"}
          </button>
          {error ? (
            <p role="alert" className="text-ember">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </main>
  );
}
