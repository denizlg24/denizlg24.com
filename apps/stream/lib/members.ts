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
import { asc, count, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  type MemberRow,
  members,
  type ProfileRow,
  profiles,
} from "@/db/schema";
import { ownerSubject } from "@/lib/config";
import {
  forgetProfileRecommendations,
  invalidateRecommendations,
} from "@/lib/recommendations";

export function serializeProfile(row: ProfileRow): Profile {
  const color = profileColorSchema.safeParse(row.color);
  return {
    id: row.id,
    name: row.name,
    color: color.success ? color.data : "ember",
    kids: row.kids,
    showIndianCinema: row.showIndianCinema,
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
  if (!(await findMember(subject))) return [];
  const rows = await db.query.profiles.findMany({
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

/** All admitted family accounts share one household; only the first creates a profile. */
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
    await tx.execute(sql`select pg_advisory_xact_lock(7311024)`);
    const [{ value }] = await tx.select({ value: count() }).from(profiles);
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
  if (!(await findMember(subject)))
    throw new Error("Family membership required");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7311024)`);
    const [{ value }] = await tx.select({ value: count() }).from(profiles);
    if (value >= MAX_PROFILES) throw new ProfileLimitError();
    const [row] = await tx
      .insert(profiles)
      .values({ memberSubject: subject, ...input })
      .returning();
    return serializeProfile(row);
  });
}

export async function ownedProfile(
  subject: string,
  profileId: string,
): Promise<ProfileRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(profileId) || !(await findMember(subject)))
    return null;
  const row = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });
  return row ?? null;
}

export async function updateProfile(
  subject: string,
  profileId: string,
  input: Partial<ProfileInput>,
): Promise<Profile | null> {
  if (!(await ownedProfile(subject, profileId))) return null;
  const [row] = await db
    .update(profiles)
    .set(input)
    .where(eq(profiles.id, profileId))
    .returning();
  // Each of these changes what may be picked for any sofa this profile is on.
  if (
    input.favoriteGenres !== undefined ||
    input.kids !== undefined ||
    input.showIndianCinema !== undefined
  )
    await invalidateRecommendations(profileId);
  return row ? serializeProfile(row) : null;
}

export class LastProfileError extends Error {}

export async function deleteProfile(
  subject: string,
  profileId: string,
): Promise<boolean> {
  if (!(await findMember(subject))) return false;
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7311024)`);
    const all = await tx.select({ id: profiles.id }).from(profiles);
    if (!all.some((profile) => profile.id === profileId)) return false;
    if (all.length === 1) throw new LastProfileError();
    await tx.delete(profiles).where(eq(profiles.id, profileId));
    return true;
  });
  if (!deleted) return false;
  await forgetProfileRecommendations(profileId);
  return true;
}

export async function listMembers() {
  return db.query.members.findMany({ orderBy: asc(members.createdAt) });
}
