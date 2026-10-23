import "server-only";

import { type AccessToken, AuthUnavailableError } from "@denizlg24/auth/server";
import { NextResponse } from "next/server";
import type { z } from "zod";

import type { MemberRow, ProfileRow } from "@/db/schema";
import { bearerVerifier, isFamilyToken } from "@/lib/auth";
import { findMember, ownedProfile, touchMember } from "@/lib/members";

export type ApiFailure = NextResponse<{ error: string }>;

export function fail(status: number, error: string): ApiFailure {
  return NextResponse.json({ error }, { status });
}

export interface ApiCaller {
  subject: string;
  member: MemberRow | null;
}

/** 401 means "sign in again" to every client, so an unreachable issuer is a 503. */
export async function authenticate(
  request: Request,
): Promise<ApiCaller | ApiFailure> {
  let token: AccessToken | null;
  try {
    token = await bearerVerifier().verifyRequest(request);
  } catch (error) {
    if (error instanceof AuthUnavailableError)
      return fail(503, "auth_unavailable");
    throw error;
  }
  if (!token) return fail(401, "unauthorized");
  if (!isFamilyToken(token)) return fail(403, "not_a_member");
  const member = await findMember(token.userId);
  if (member) void touchMember(member.subject);
  return { subject: token.userId, member };
}

export async function requireMember(
  request: Request,
): Promise<{ subject: string; member: MemberRow } | ApiFailure> {
  const caller = await authenticate(request);
  if (caller instanceof NextResponse) return caller;
  if (!caller.member) return fail(409, "needs_setup");
  return { subject: caller.subject, member: caller.member };
}

export async function requireProfile(
  request: Request,
  profileId: string | null,
): Promise<
  { subject: string; member: MemberRow; profile: ProfileRow } | ApiFailure
> {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  if (!profileId) return fail(400, "profile_required");
  const profile = await ownedProfile(caller.subject, profileId);
  if (!profile) return fail(404, "profile_not_found");
  return { ...caller, profile };
}

export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | ApiFailure> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "invalid_body");
  }
  return parsed.data;
}

export function profileParam(request: Request): string | null {
  return new URL(request.url).searchParams.get("profile");
}

/** `?profiles=a,b`: whoever is on the sofa, all of them the caller's own. */
export async function requireAudience(
  request: Request,
): Promise<
  { subject: string; member: MemberRow; profiles: ProfileRow[] } | ApiFailure
> {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const ids = [
    ...new Set(
      (new URL(request.url).searchParams.get("profiles") ?? "")
        .split(",")
        .filter((id) => id.length > 0),
    ),
  ];
  if (ids.length === 0 || ids.length > 5) return fail(400, "profiles_required");
  const profiles = await Promise.all(
    ids.map((id) => ownedProfile(caller.subject, id)),
  );
  if (profiles.some((profile) => profile === null)) {
    return fail(404, "profile_not_found");
  }
  return {
    ...caller,
    profiles: profiles.filter(
      (profile): profile is ProfileRow => profile !== null,
    ),
  };
}
