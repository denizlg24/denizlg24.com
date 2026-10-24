"use client";

import {
  type Genre,
  type Profile,
  type ProfileColor,
  type ProfileLayout,
  STREAM_GENRES,
} from "@repo/schemas/stream";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { addProfile, editProfile, removeProfile } from "@/app/actions";
import { ColorChoice } from "@/components/color-choice";
import { ProfileDisc } from "@/components/profile-disc";

const LAYOUTS: { value: ProfileLayout; title: string; body: string }[] = [
  {
    value: "studio",
    title: "Studio",
    body: "Tonight's picks, the dials and the map.",
  },
  {
    value: "classic",
    title: "Simple",
    body: "Bigger text and a few plain rows. Easy on a TV.",
  },
];

export function ProfileEditor({
  profile,
  canDelete,
  onDone,
}: {
  profile: Profile | null;
  canDelete: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const focusOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);
  const [name, setName] = useState(profile?.name ?? "");
  const [color, setColor] = useState<ProfileColor>(profile?.color ?? "tide");
  const [kids, setKids] = useState(profile?.kids ?? false);
  const [indianCinema, setIndianCinema] = useState(
    profile?.showIndianCinema ?? false,
  );
  const [layout, setLayout] = useState<ProfileLayout>(
    profile?.layout ?? "studio",
  );
  const [genres, setGenres] = useState<Genre[]>(profile?.favoriteGenres ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        router.refresh();
        onDone();
      } else {
        setError(result.error);
      }
    });

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const input = {
      name,
      color,
      kids,
      showIndianCinema: indianCinema,
      layout,
      favoriteGenres: genres,
    };
    run(() => (profile ? editProfile(profile.id, input) : addProfile(input)));
  };

  const toggleGenre = (genre: Genre) =>
    setGenres((current) =>
      current.includes(genre)
        ? current.filter((item) => item !== genre)
        : current.length < 6
          ? [...current, genre]
          : current,
    );

  return (
    <form
      onSubmit={save}
      className="space-y-10 rounded-2xl bg-raised p-6 md:p-10"
    >
      <div className="flex items-center gap-6">
        <ProfileDisc name={name || "?"} color={color} size="md" />
        <label className="flex-1">
          <span className="sr-only">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={24}
            ref={focusOnMount}
            data-nav
            placeholder="Name"
            className="w-full border-b border-hairline bg-transparent pb-2 font-display text-4xl outline-none placeholder:text-faint focus:border-amber"
          />
        </label>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm text-muted">Colour</legend>
        <ColorChoice value={color} onChange={setColor} />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm text-muted">
          How Stream looks for this profile
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {LAYOUTS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-nav
              aria-pressed={layout === option.value}
              onClick={() => setLayout(option.value)}
              className={`space-y-1 rounded-xl p-5 text-left transition-colors ${layout === option.value ? "bg-paper text-ink" : "ring-1 ring-hairline hover:ring-paper/40"}`}
            >
              <span className="block text-lg font-medium">{option.title}</span>
              <span
                className={`block text-sm ${layout === option.value ? "text-ink/70" : "text-muted"}`}
              >
                {option.body}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex cursor-pointer items-center gap-4">
        <input
          type="checkbox"
          checked={kids}
          onChange={(event) => setKids(event.target.checked)}
          data-nav
          className="size-6 accent-amber"
        />
        <span>
          <span className="block text-lg">Kids profile</span>
          <span className="block text-sm text-muted">
            Only shows titles suitable for children. When a kids profile is on
            the sofa, everyone's picks stay child-friendly.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-center gap-4">
        <input
          type="checkbox"
          checked={indianCinema}
          onChange={(event) => setIndianCinema(event.target.checked)}
          data-nav
          className="size-6 accent-amber"
        />
        <span>
          <span className="block text-lg">Show Bollywood and Indian films</span>
          <span className="block text-sm text-muted">
            Films and series in Hindi, Tamil, Telugu and other Indian languages.
            They only appear when everyone on the sofa has this on.
          </span>
        </span>
      </label>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm text-muted">
          Favourite genres{" "}
          <span className="text-faint">(up to six — they help the picks)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {STREAM_GENRES.map((genre) => {
            const on = genres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                data-nav
                aria-pressed={on}
                onClick={() => toggleGenre(genre)}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${on ? "bg-amber text-ink" : "text-muted ring-1 ring-hairline hover:text-paper"}`}
              >
                {genre}
              </button>
            );
          })}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-ember">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          data-nav
          disabled={pending || name.trim().length === 0}
          className="rounded-full bg-amber px-7 py-3 font-medium text-ink disabled:opacity-40"
        >
          {pending ? "Saving…" : profile ? "Save changes" : "Add profile"}
        </button>
        <button
          type="button"
          data-nav
          onClick={onDone}
          className="rounded-full px-6 py-3 text-muted hover:text-paper"
        >
          Cancel
        </button>
        {profile && canDelete ? (
          <button
            type="button"
            data-nav
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${profile.name}? Their list and history will be deleted.`,
                )
              ) {
                run(() => removeProfile(profile.id));
              }
            }}
            className="ml-auto rounded-full px-6 py-3 text-ember hover:bg-ember/10"
          >
            Remove profile
          </button>
        ) : null}
      </div>
    </form>
  );
}
