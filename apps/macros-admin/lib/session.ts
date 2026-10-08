import "server-only";

import type { DenizSession } from "@denizlg24/auth/next";
import { redirect } from "next/navigation";

import { auth, isOwnerToken } from "@/lib/auth";

export const FORBIDDEN_PATH = "/sign-in?auth_error=forbidden";

/** Pages: signed out goes to sign-in, a non-owner session to the refusal. */
export async function requireOwner(returnTo: string): Promise<DenizSession> {
  const session = await auth.requireSession(returnTo);
  if (!isOwnerToken(session.token)) redirect(FORBIDDEN_PATH);
  return session;
}

/** Server actions answer instead of redirecting mid-mutation. */
export async function ownerSession(): Promise<DenizSession | null> {
  const session = await auth.getSession();
  return session && isOwnerToken(session.token) ? session : null;
}
