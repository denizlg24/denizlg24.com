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
  return createHmac("sha256", secret)
    .update("forge-preview-share-link")
    .digest("hex");
}

function signature(deploymentId: string, expiresAt: number, key: string) {
  return createHmac("sha256", key)
    .update(`${deploymentId}:${expiresAt}`)
    .digest("hex");
}

export function generatePreviewShareToken(
  deploymentId: string,
  expiresIn: ShareExpiresIn,
  secret: string,
  now = Date.now(),
): string {
  const expiresAt = expiresIn === "never" ? 0 : now + DURATIONS_MS[expiresIn];
  return `${deploymentId}.${expiresAt}.${signature(
    deploymentId,
    expiresAt,
    deriveKey(secret),
  )}`;
}

export function verifyPreviewShareToken(
  token: string,
  secret: string,
  now = Date.now(),
): { deploymentId: string; expiresAt: number } | null {
  const [deploymentId, expiresAtText, actual, ...extra] = token.split(".");
  if (!deploymentId || !expiresAtText || !actual || extra.length > 0) {
    return null;
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(expiresAtText)) return null;
  const expiresAt = Number.parseInt(expiresAtText, 10);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) return null;

  const expected = signature(deploymentId, expiresAt, deriveKey(secret));
  if (actual.length !== expected.length || !/^[0-9a-f]{64}$/i.test(actual)) {
    return null;
  }
  if (
    !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  ) {
    return null;
  }
  if (expiresAt !== 0 && now > expiresAt) return null;
  return { deploymentId, expiresAt };
}
