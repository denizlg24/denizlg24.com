import { createHmac } from "node:crypto";

/**
 * A stable pseudonym for a contributor, so the console can follow one person
 * across reports without showing who they are. Keyed by the auth secret, so it
 * cannot be reversed or recomputed from a user id alone.
 */
export function contributorAlias(userId: string): string {
  const secret = process.env.MACROS_BETTER_AUTH_SECRET;
  if (!secret) throw new Error("MACROS_BETTER_AUTH_SECRET is required");
  const digest = createHmac("sha256", secret)
    .update(`contributor:${userId}`)
    .digest("hex");
  return `C-${digest.slice(0, 6).toUpperCase()}`;
}

export function contributorRef(userId: string) {
  return { id: userId, alias: contributorAlias(userId) };
}
