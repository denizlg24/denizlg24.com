"use client";

import { MAX_PROFILES, type Profile } from "@repo/schemas/stream";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { ProfileEditor } from "@/app/profiles/profile-editor";
import { ProfileDisc } from "@/components/profile-disc";

export function ProfilesView({
  profiles,
  startNew,
}: {
  profiles: Profile[];
  startNew: boolean;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(
    startNew ? "new" : null,
  );
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-hairline border-y border-hairline">
        {profiles.map((profile) =>
          editing === profile.id ? (
            <li key={profile.id} className="py-4">
              <ProfileEditor
                profile={profile}
                canDelete={profiles.length > 1}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={profile.id}>
              <button
                type="button"
                data-nav
                onClick={() => setEditing(profile.id)}
                className="flex w-full items-center gap-5 px-2 py-5 text-left transition-colors hover:bg-raised/60"
              >
                <ProfileDisc
                  name={profile.name}
                  color={profile.color}
                  size="md"
                />
                <span className="flex-1 space-y-1">
                  <span className="block text-xl">{profile.name}</span>
                  <span className="block text-sm text-muted">
                    {[
                      profile.layout === "classic"
                        ? "Simple layout"
                        : "Studio layout",
                      profile.kids ? "Kids" : null,
                      profile.favoriteGenres.length > 0
                        ? profile.favoriteGenres.join(", ")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
                <Pencil className="size-4 text-muted" />
              </button>
            </li>
          ),
        )}
      </ul>
      {editing === "new" ? (
        <ProfileEditor
          profile={null}
          canDelete={false}
          onDone={() => setEditing(null)}
        />
      ) : profiles.length < MAX_PROFILES ? (
        <button
          type="button"
          data-nav
          onClick={() => setEditing("new")}
          className="flex items-center gap-3 rounded-full px-5 py-3 text-muted ring-1 ring-hairline transition-colors hover:text-paper"
        >
          <Plus className="size-4" /> Add a profile
        </button>
      ) : (
        <p className="text-sm text-muted">
          Each account can have up to {MAX_PROFILES} profiles.
        </p>
      )}
    </div>
  );
}
