"use client";

import type { Profile } from "@repo/schemas/stream";
import { ChevronDown, LogOut, Pencil, Users } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { chooseAudience } from "@/app/actions";
import { usePopover } from "@/components/nav/use-popover";
import { joinNames, ProfileDisc } from "@/components/profile-disc";

export function ProfileMenu({
  audience,
  profiles,
  logoutUrl,
}: {
  audience: Profile[];
  profiles: Profile[];
  logoutUrl: string;
}) {
  const { open, setOpen, root } = usePopover<HTMLDivElement>();
  const [pending, startTransition] = useTransition();
  const watching = new Set(audience.map((profile) => profile.id));
  const others = profiles.filter((profile) => !watching.has(profile.id));

  const switchTo = (id: string) =>
    startTransition(async () => {
      const result = await chooseAudience([id]);
      if (result.ok) window.location.assign(window.location.pathname);
    });

  const item =
    "flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left text-sm text-paper/85 transition-colors hover:bg-paper/5 hover:text-paper focus-visible:bg-paper/5";

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        data-nav
        data-popover-trigger
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Watching: ${joinNames(audience.map((p) => p.name))}. Account menu`}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-[4px] p-0.5"
      >
        <span className="flex -space-x-3">
          {audience.slice(0, 3).map((profile) => (
            <ProfileDisc
              key={profile.id}
              name={profile.name}
              color={profile.color}
              size="sm"
              className="ring-2 ring-ink"
            />
          ))}
        </span>
        <ChevronDown
          className={`hidden size-4 transition-transform duration-200 sm:block ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute top-[calc(100%+0.75rem)] right-0 w-60 max-w-[calc(100vw-2*var(--gutter))] border border-hairline bg-ink/95 py-2 shadow-2xl backdrop-blur-md"
        >
          {others.length > 0 ? (
            <ul className="pb-2">
              {others.map((profile) => (
                <li key={profile.id}>
                  <button
                    type="button"
                    role="menuitem"
                    data-nav
                    disabled={pending}
                    onClick={() => switchTo(profile.id)}
                    className={item}
                  >
                    <ProfileDisc
                      name={profile.name}
                      color={profile.color}
                      size="xs"
                    />
                    <span className="truncate">{profile.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Link
            href="/sofa?together=1"
            role="menuitem"
            data-nav
            className={item}
          >
            <Users className="size-5 shrink-0 text-paper/60" aria-hidden />
            Watch together
          </Link>
          <Link href="/profiles" role="menuitem" data-nav className={item}>
            <Pencil className="size-5 shrink-0 text-paper/60" aria-hidden />
            Manage profiles
          </Link>
          <div className="my-2 border-t border-hairline" />
          <a href={logoutUrl} role="menuitem" data-nav className={item}>
            <LogOut className="size-5 shrink-0 text-paper/60" aria-hidden />
            Sign out of Stream
          </a>
        </div>
      ) : null}
    </div>
  );
}
