import { createHmac, timingSafeEqual } from "node:crypto";

import type { ShareExpiresIn } from "@repo/schemas/cloud";

const DURATIONS_MS = {
  "30m": 30 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
  never: 0,
} as const satisfies Record<ShareExpiresIn, number>;

function deriveKey(secret: string): string {
  return createHmac("sha256", secret).update("dc-share-link").digest("hex");
}

function sign(fileId: string, expiresAt: number, key: string): string {
  return createHmac("sha256", key)
    .update(`${fileId}:${expiresAt}`)
    .digest("hex");
}

export function generateShareToken(
  fileId: string,
  expiresIn: ShareExpiresIn,
  secret: string,
  now = Date.now(),
): string {
  const expiresAt = expiresIn === "never" ? 0 : now + DURATIONS_MS[expiresIn];
  return `${fileId}.${expiresAt}.${sign(fileId, expiresAt, deriveKey(secret))}`;
}

export function verifyShareToken(
  token: string,
  secret: string,
  now = Date.now(),
): { fileId: string; expiresAt: number } | null {
  const [fileId, expiresAtText, signature, ...extra] = token.split(".");
  if (!fileId || !expiresAtText || !signature || extra.length > 0) {
    return null;
  }
  const expiresAt = Number.parseInt(expiresAtText, 10);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }
  const expected = sign(fileId, expiresAt, deriveKey(secret));
  if (
    signature.length !== expected.length ||
    !/^[0-9a-fA-F]{64}$/.test(signature)
  ) {
    return null;
  }
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  if (expiresAt !== 0 && now > expiresAt) {
    return null;
  }
  return { fileId, expiresAt };
}
