import "server-only";

import {
  genreSchema,
  MAX_PROFILES,
  type Me,
  type Profile,
  type ProfileColor,
  type ProfileInput,
  profileColorSchema,
  profileLayoutSchema,
} from "@repo/schemas/stream";
import { and, asc, count, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  type MemberRow,
  members,
  type ProfileRow,
  profiles,
} from "@/db/schema";
import { ownerSubject } from "@/lib/config";
import { forgetProfileRecommendations } from "@/lib/recommendations";

export function serializeProfile(row: ProfileRow): Profile {
  const color = profileColorSchema.safeParse(row.color);
  return {
    id: row.id,
    name: row.name,
    color: color.success ? color.data : "ember",
    kids: row.kids,
    layout: profileLayoutSchema.safeParse(row.layout).data ?? "studio",
    favoriteGenres: row.favoriteGenres.flatMap((genre) => {
      const parsed = genreSchema.safeParse(genre);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

export async function findMember(subject: string): Promise<MemberRow | null> {
  const row = await db.query.members.findFirst({
    where: eq(members.subject, subject),
  });
  if (!row) return null;
  const role = subject === ownerSubject() ? "owner" : "member";
  if (row.role !== role) {
    await db.update(members).set({ role }).where(eq(members.subject, subject));
    return { ...row, role };
  }
  return row;
}

export async function touchMember(subject: string): Promise<void> {
  await db
    .update(members)
    .set({ lastSeenAt: new Date() })
    .where(eq(members.subject, subject));
}

export async function listProfiles(subject: string): Promise<Profile[]> {
  const rows = await db.query.profiles.findMany({
    where: eq(profiles.memberSubject, subject),
    orderBy: asc(profiles.createdAt),
  });
  return rows.map(serializeProfile);
}

export async function me(member: MemberRow): Promise<Me> {
  return {
    member: { subject: member.subject, name: member.name, role: member.role },
    profiles: await listProfiles(member.subject),
  };
}

/** First sign-in: the account and its first profile are one step. */
export async function createMember(
  subject: string,
  name: string,
  color: ProfileColor,
): Promise<MemberRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(members)
      .values({
        subject,
        name,
        role: subject === ownerSubject() ? "owner" : "member",
      })
      .onConflictDoUpdate({ target: members.subject, set: { name } })
      .returning();
    const [{ value }] = await tx
      .select({ value: count() })
      .from(profiles)
      .where(eq(profiles.memberSubject, subject));
    if (value === 0) {
      await tx.insert(profiles).values({ memberSubject: subject, name, color });
    }
    return row;
  });
}

export class ProfileLimitError extends Error {}

export async function createProfile(
  subject: string,
  input: ProfileInput,
): Promise<Profile> {
  const existing = await db
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.memberSubject, subject));
  if ((existing[0]?.value ?? 0) >= MAX_PROFILES) throw new ProfileLimitError();
  const [row] = await db
    .insert(profiles)
    .values({ memberSubject: subject, ...input })
    .returning();
  return serializeProfile(row);
}

export async function ownedProfile(
  subject: string,
  profileId: string,
): Promise<ProfileRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return null;
  const row = await db.query.profiles.findFirst({
    where: and(eq(profiles.id, profileId), eq(profiles.memberSubject, subject)),
  });
  return row ?? null;
}

export async function updateProfile(
  subject: string,
  profileId: string,
  input: Partial<ProfileInput>,
): Promise<Profile | null> {
  const [row] = await db
    .update(profiles)
    .set(input)
    .where(and(eq(profiles.id, profileId), eq(profiles.memberSubject, subject)))
    .returning();
  return row ? serializeProfile(row) : null;
}

export class LastProfileError extends Error {}

export async function deleteProfile(
  subject: string,
  profileId: string,
): Promise<boolean> {
  const all = await listProfiles(subject);
  if (!all.some((profile) => profile.id === profileId)) return false;
  if (all.length === 1) throw new LastProfileError();
  await db
    .delete(profiles)
    .where(
      and(eq(profiles.id, profileId), eq(profiles.memberSubject, subject)),
    );
  await forgetProfileRecommendations(profileId);
  return true;
}

export async function listMembers() {
  return db.query.members.findMany({ orderBy: asc(members.createdAt) });
}
