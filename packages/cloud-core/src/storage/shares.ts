import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { ShareExpiresIn } from "@repo/schemas/cloud";

const DURATIONS_MS = {
  "30m": 30 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
  never: 0,
} as const satisfies Record<ShareExpiresIn, number>;

/** An unlocked password share stays unlocked this long, or until the share expires. */
export const SHARE_UNLOCK_MAX_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * A share token is 32 random bytes; only its SHA-256 is stored, so a leaked
 * database row cannot open anything. base64url carries no `.`, which is what
 * separates it from a legacy `fileId.expiresAt.hmac` token on the wire.
 */
export function generateShareSecret(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isLegacyShareToken(token: string): boolean {
  return token.split(".").length === 3;
}

export function shareExpiresAt(
  expiresIn: ShareExpiresIn,
  now = Date.now(),
): Date | null {
  return expiresIn === "never" ? null : new Date(now + DURATIONS_MS[expiresIn]);
}

export type ShareStatus = "active" | "expired" | "revoked";

export function shareStatus(
  share: { expiresAt: Date | null; revokedAt: Date | null },
  now = Date.now(),
): ShareStatus {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt && share.expiresAt.getTime() <= now) return "expired";
  return "active";
}

export function shareCookieName(shareId: string): string {
  return `__Host-share-${shareId}`;
}

/**
 * What the unlock cookie carries: an HMAC over the share and its token hash,
 * so it proves the password was entered for this exact link and stops
 * meaning anything once the link is rotated or revoked.
 */
export function shareCookieValue(
  shareId: string,
  tokenHash: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`share-unlock:${shareId}:${tokenHash}`)
    .digest("base64url");
}

export function verifyShareCookie(
  value: string | undefined,
  shareId: string,
  tokenHash: string,
  secret: string,
): boolean {
  if (!value) return false;
  const expected = shareCookieValue(shareId, tokenHash, secret);
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads one cookie out of a request's Cookie header without a parser dependency. */
export function readCookie(
  header: string | null | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/** How long an unlock cookie may live: the share's own expiry, capped. */
export function unlockCookieMaxAgeSeconds(
  expiresAt: Date | null,
  now = Date.now(),
): number {
  const untilExpiry = expiresAt
    ? expiresAt.getTime() - now
    : SHARE_UNLOCK_MAX_MS;
  return Math.max(
    60,
    Math.floor(Math.min(untilExpiry, SHARE_UNLOCK_MAX_MS) / 1_000),
  );
}
