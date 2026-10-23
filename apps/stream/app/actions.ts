"use server";

import {
  memberSetupSchema,
  profileInputSchema,
  profileUpdateSchema,
  progressInputSchema,
  titleIdSchema,
} from "@repo/schemas/stream";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { findTitle, saveProgress, setWatchlist } from "@/lib/catalog";
import { streamBaseUrl } from "@/lib/config";
import { devSubject } from "@/lib/dev-session";
import {
  createMember,
  createProfile,
  deleteProfile,
  findMember,
  LastProfileError,
  ownedProfile,
  ProfileLimitError,
  updateProfile,
} from "@/lib/members";
import { invalidateRecommendations } from "@/lib/recommendations";
import { readSofa, SOFA_COOKIE, TV_COOKIE } from "@/lib/viewer";

export type ActionResult = { ok: true } | { ok: false; error: string };

const YEAR = 60 * 60 * 24 * 365;

async function signedIn() {
  const dev = devSubject();
  if (dev) return dev;
  const session = await auth.getSession();
  if (!session) redirect("/sign-in");
  return session.user.id;
}

async function member() {
  const subject = await signedIn();
  const row = await findMember(subject);
  if (!row) redirect("/welcome");
  return row;
}

export async function setUp(input: unknown): Promise<ActionResult> {
  const subject = await signedIn();
  const parsed = memberSetupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please enter a name." };
  await createMember(subject, parsed.data.name, parsed.data.color);
  return { ok: true };
}

export async function sitDown(
  profileIds: string[],
  next: string,
): Promise<void> {
  const row = await member();
  const owned = await Promise.all(
    profileIds.slice(0, 5).map((id) => ownedProfile(row.subject, id)),
  );
  const ids = owned.flatMap((profile) => (profile ? [profile.id] : []));
  if (ids.length === 0) redirect("/sofa");
  (await cookies()).set(SOFA_COOKIE, ids.join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: streamBaseUrl().startsWith("https:"),
    path: "/",
    maxAge: YEAR,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function setTvMode(on: boolean | null): Promise<void> {
  const jar = await cookies();
  if (on === null) jar.delete(TV_COOKIE);
  else
    jar.set(TV_COOKIE, on ? "1" : "0", {
      path: "/",
      maxAge: YEAR,
      sameSite: "lax",
    });
}

/** Saving to "my list" saves for everyone on the sofa. */
export async function toggleSaved(
  titleId: string,
  saved: boolean,
): Promise<ActionResult> {
  const row = await member();
  const id = titleIdSchema.safeParse(titleId);
  if (!id.success || !(await findTitle(id.data))) {
    return { ok: false, error: "That title couldn't be found." };
  }
  const audience = await readSofa(row.subject);
  await Promise.all(
    audience.map((profile) => setWatchlist(profile.id, id.data, saved)),
  );
  return { ok: true };
}

export async function reportProgress(input: unknown): Promise<ActionResult> {
  const row = await member();
  const parsed = progressInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const audience = await readSofa(row.subject);
  const saved = await Promise.all(
    audience.map((profile) => saveProgress(profile.id, parsed.data)),
  );
  await Promise.all(
    audience
      .filter((_, index) => saved[index]?.completed)
      .map((profile) => invalidateRecommendations(profile.id)),
  );
  return { ok: true };
}

export async function addProfile(input: unknown): Promise<ActionResult> {
  const row = await member();
  const parsed = profileInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please enter a name." };
  try {
    await createProfile(row.subject, parsed.data);
    return { ok: true };
  } catch (error) {
    if (error instanceof ProfileLimitError) {
      return { ok: false, error: "You can have up to five profiles." };
    }
    throw error;
  }
}

export async function editProfile(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const row = await member();
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the details." };
  const updated = await updateProfile(
    row.subject,
    z.string().parse(id),
    parsed.data,
  );
  if (parsed.data.favoriteGenres) await invalidateRecommendations(id);
  return updated ? { ok: true } : { ok: false, error: "Profile not found." };
}

export async function removeProfile(id: string): Promise<ActionResult> {
  const row = await member();
  try {
    const removed = await deleteProfile(row.subject, id);
    return removed ? { ok: true } : { ok: false, error: "Profile not found." };
  } catch (error) {
    if (error instanceof LastProfileError) {
      return { ok: false, error: "Every account keeps at least one profile." };
    }
    throw error;
  }
}
