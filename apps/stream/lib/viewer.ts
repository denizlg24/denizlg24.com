import "server-only";

import type { Profile, ProfileLayout } from "@repo/schemas/stream";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { MemberRow, ProfileRow } from "@/db/schema";
import { auth } from "@/lib/auth";
import { devSubject } from "@/lib/dev-session";
import {
  findMember,
  listProfiles,
  ownedProfile,
  serializeProfile,
} from "@/lib/members";

export const SOFA_COOKIE = "stream-sofa";
export const TV_COOKIE = "stream-tv";

const TV_AGENTS =
  /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|AFT[A-Z]|BRAVIA|Android TV|GoogleTV|CrKey|HbbTV|Viera|Roku|PlayStation|Xbox/i;

export async function isTv(): Promise<boolean> {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  const forced = jar.get(TV_COOKIE)?.value;
  if (forced === "1") return true;
  if (forced === "0") return false;
  return TV_AGENTS.test(list.get("user-agent") ?? "");
}

export interface Viewer {
  subject: string;
  member: MemberRow;
  profiles: Profile[];
  audience: ProfileRow[];
  layout: ProfileLayout;
}

/** The simpler layout wins: if anyone on the sofa prefers classic, the room gets classic. */
export function layoutFor(audience: readonly ProfileRow[]): ProfileLayout {
  return audience.some((profile) => profile.layout === "classic")
    ? "classic"
    : "studio";
}

export async function requireSubject(returnTo: string): Promise<string> {
  return devSubject() ?? (await auth.requireSession(returnTo)).user.id;
}

export async function requireMemberSession(returnTo: string) {
  const subject = await requireSubject(returnTo);
  const member = await findMember(subject);
  if (!member) redirect("/welcome");
  return { subject, member };
}

export async function readSofa(subject: string): Promise<ProfileRow[]> {
  const jar = await cookies();
  const ids = (jar.get(SOFA_COOKIE)?.value ?? "")
    .split(",")
    .filter((id) => id.length > 0)
    .slice(0, 5);
  if (ids.length === 0) {
    const all = await listProfiles(subject);
    if (all.length === 1) {
      const only = await ownedProfile(subject, all[0].id);
      return only ? [only] : [];
    }
  }
  const rows = await Promise.all(ids.map((id) => ownedProfile(subject, id)));
  return rows.filter((row): row is ProfileRow => row !== null);
}

/** Signed in, set up, and someone on the sofa — or sent to whichever step is missing. */
export async function requireViewer(returnTo: string): Promise<Viewer> {
  const { subject, member } = await requireMemberSession(returnTo);
  const [profiles, audience] = await Promise.all([
    listProfiles(member.subject),
    readSofa(member.subject),
  ]);
  if (audience.length === 0) {
    if (profiles.length === 1) {
      const only = await ownedProfile(member.subject, profiles[0].id);
      if (only) {
        return {
          subject,
          member,
          profiles,
          audience: [only],
          layout: layoutFor([only]),
        };
      }
    }
    redirect(`/sofa?next=${encodeURIComponent(returnTo)}`);
  }
  return {
    subject,
    member,
    profiles,
    audience,
    layout: layoutFor(audience),
  };
}

export function audienceProfiles(viewer: Viewer): Profile[] {
  return viewer.audience.map(serializeProfile);
}
