import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { hashPassword, verifyPassword } from "../auth/password";
import type { Database } from "../db";
import { davCredentials, users } from "../db/schema";
import { toSafeUser } from "../services/auth";
import type { SafeUserRecord } from "../services/types";

/** No `0`/`o`/`1`/`l`: these get typed by hand into a mount dialog. */
const SECRET_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SECRET_GROUPS = 4;
const SECRET_GROUP_LENGTH = 5;

export interface SafeDavCredential {
  id: string;
  name: string;
  secretPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface IssuedDavCredential extends SafeDavCredential {
  /** Returned once, at creation. Only the hash is stored. */
  secret: string;
}

export function generateDavSecret(): string {
  const bytes = new Uint8Array(SECRET_GROUPS * SECRET_GROUP_LENGTH);
  crypto.getRandomValues(bytes);
  const chars = Array.from(
    bytes,
    (byte) => SECRET_ALPHABET[byte % SECRET_ALPHABET.length] ?? "a",
  );
  const groups: string[] = [];
  for (let index = 0; index < SECRET_GROUPS; index += 1) {
    groups.push(
      chars
        .slice(index * SECRET_GROUP_LENGTH, (index + 1) * SECRET_GROUP_LENGTH)
        .join(""),
    );
  }
  return groups.join("-");
}

function toSafeCredential(record: {
  id: string;
  name: string;
  secretPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): SafeDavCredential {
  return {
    id: record.id,
    name: record.name,
    secretPrefix: record.secretPrefix,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export async function issueDavCredential(
  db: Database,
  input: { userId: string; name: string; expiresAt?: Date | null },
): Promise<IssuedDavCredential> {
  const secret = generateDavSecret();
  const [created] = await db
    .insert(davCredentials)
    .values({
      userId: input.userId,
      name: input.name,
      secretHash: await hashPassword(secret),
      secretPrefix: secret.slice(0, SECRET_GROUP_LENGTH),
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!created) throw new Error("Failed to issue WebDAV credential");
  return { ...toSafeCredential(created), secret };
}

export async function listDavCredentials(
  db: Database,
  userId: string,
): Promise<SafeDavCredential[]> {
  const records = await db
    .select()
    .from(davCredentials)
    .where(eq(davCredentials.userId, userId))
    .orderBy(davCredentials.createdAt);
  return records.map(toSafeCredential);
}

export async function revokeDavCredential(
  db: Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(davCredentials)
    .where(and(eq(davCredentials.id, id), eq(davCredentials.userId, userId)))
    .returning({ id: davCredentials.id });
  return deleted.length === 1;
}

/**
 * Skips the argon2 verification for a credential already proven this session.
 *
 * Finder opens a folder and fires dozens of requests; at 19 MiB of memory cost
 * each, verifying every one of them would put argon2 on the critical path of
 * the whole mount. Only the *verification* is cached — the credential row and
 * the user row are re-read on every request, so revoking a credential or
 * deactivating an account takes effect immediately rather than after the TTL.
 */
const VERIFICATION_TTL_MS = 5 * 60 * 1_000;
const VERIFICATION_CACHE_LIMIT = 64;
const verificationCache = new Map<
  string,
  { credentialId: string; expiresAt: number }
>();

function cacheKey(username: string, secret: string): string {
  return createHash("sha256").update(`${username}\0${secret}`).digest("hex");
}

function rememberVerification(key: string, credentialId: string): void {
  if (verificationCache.size >= VERIFICATION_CACHE_LIMIT) {
    const oldest = verificationCache.keys().next().value;
    if (typeof oldest === "string") verificationCache.delete(oldest);
  }
  verificationCache.set(key, {
    credentialId,
    expiresAt: Date.now() + VERIFICATION_TTL_MS,
  });
}

export function clearDavVerificationCache(): void {
  verificationCache.clear();
}

export async function resolveDavCredential(
  db: Database,
  username: string,
  secret: string,
): Promise<SafeUserRecord | null> {
  if (!username || !secret) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (user?.status !== "active") return null;

  const candidates = await db
    .select()
    .from(davCredentials)
    .where(eq(davCredentials.userId, user.id));
  if (candidates.length === 0) return null;

  const now = new Date();
  const usable = candidates.filter(
    (candidate) => !candidate.expiresAt || candidate.expiresAt > now,
  );
  if (usable.length === 0) return null;

  const key = cacheKey(username, secret);
  const cached = verificationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const match = usable.find(
      (candidate) => candidate.id === cached.credentialId,
    );
    if (match) {
      void touchCredential(db, match.id);
      return toSafeUser(user);
    }
    verificationCache.delete(key);
  }

  for (const candidate of usable) {
    const valid = await verifyPassword({
      hash: candidate.secretHash,
      password: secret,
    });
    if (!valid) continue;
    rememberVerification(key, candidate.id);
    void touchCredential(db, candidate.id);
    return toSafeUser(user);
  }
  return null;
}

function touchCredential(db: Database, id: string): Promise<unknown> {
  return db
    .update(davCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(davCredentials.id, id))
    .catch(console.error);
}
