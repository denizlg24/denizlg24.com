import "server-only";

import type { Profile } from "@repo/schemas/stream";
import { cache } from "react";

import type { MemberRow, ProfileRow } from "@/db/schema";
import { auth } from "@/lib/auth";
import { listWatchlist } from "@/lib/catalog";
import { devSubject } from "@/lib/dev-session";
import { findMember, listProfiles } from "@/lib/members";
import { readSofa } from "@/lib/viewer";

export interface CurrentViewer {
  member: MemberRow;
  profiles: Profile[];
  audience: ProfileRow[];
}

/**
 * The layouts' view of who is watching. Unlike `requireViewer` it never
 * redirects: layouts render for signed-out pages too, and each page still
 * calls `requireViewer` with its own return path.
 */
export const currentViewer = cache(async (): Promise<CurrentViewer | null> => {
  const subject = devSubject() ?? (await auth.getSession())?.user.id ?? null;
  if (!subject) return null;
  const member = await findMember(subject);
  if (!member) return null;
  const [profiles, audience] = await Promise.all([
    listProfiles(member.subject),
    readSofa(member.subject),
  ]);
  if (audience.length === 0) return null;
  return { member, profiles, audience };
});

export const savedTitleIds = cache(
  async (viewer: CurrentViewer): Promise<string[]> =>
    (await listWatchlist(viewer.audience[0].id)).map((title) => title.id),
);

/** "Larger text" is stored as the old `classic` layout. */
export function wantsLargeText(audience: readonly ProfileRow[]): boolean {
  return audience.some((profile) => profile.layout === "classic");
}
