import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { Database } from "@repo/cloud-core";
import { previewShareGrants } from "@repo/cloud-core/db/schema";
import type { ShareExpiresIn } from "@repo/schemas/cloud";
import { eq } from "drizzle-orm";

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

function signature(
  grantId: string,
  deploymentId: string,
  expiresAt: number,
  key: string,
) {
  return createHmac("sha256", key)
    .update(`${grantId}:${deploymentId}:${expiresAt}`)
    .digest("hex");
}

export async function generatePreviewShareToken(
  db: Database,
  deploymentId: string,
  expiresIn: ShareExpiresIn,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const grantId = randomUUID();
  const expiresAt = expiresIn === "never" ? 0 : now + DURATIONS_MS[expiresIn];
  await db.insert(previewShareGrants).values({
    id: grantId,
    deploymentId,
    expiresAt: expiresAt === 0 ? null : new Date(expiresAt),
  });
  return `${grantId}.${deploymentId}.${expiresAt}.${signature(
    grantId,
    deploymentId,
    expiresAt,
    deriveKey(secret),
  )}`;
}

export async function verifyPreviewShareToken(
  db: Database,
  token: string,
  secret: string,
  now = Date.now(),
): Promise<{
  deploymentId: string;
  expiresAt: number;
  grantId: string;
} | null> {
  const [grantId, deploymentId, expiresAtText, actual, ...extra] =
    token.split(".");
  if (
    !grantId ||
    !deploymentId ||
    !expiresAtText ||
    !actual ||
    extra.length > 0
  ) {
    return null;
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(expiresAtText)) return null;
  const expiresAt = Number.parseInt(expiresAtText, 10);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) return null;

  const expected = signature(
    grantId,
    deploymentId,
    expiresAt,
    deriveKey(secret),
  );
  if (actual.length !== expected.length || !/^[0-9a-f]{64}$/i.test(actual)) {
    return null;
  }
  if (
    !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  ) {
    return null;
  }
  if (expiresAt !== 0 && now > expiresAt) return null;

  const grant = await db.query.previewShareGrants.findFirst({
    columns: { deploymentId: true, expiresAt: true, revokedAt: true },
    where: eq(previewShareGrants.id, grantId),
  });
  const persistedExpiry = grant?.expiresAt?.getTime() ?? 0;
  if (
    !grant ||
    grant.revokedAt !== null ||
    grant.deploymentId !== deploymentId ||
    persistedExpiry !== expiresAt ||
    (persistedExpiry !== 0 && now > persistedExpiry)
  ) {
    return null;
  }
  return { deploymentId, expiresAt, grantId };
}

/** Revokes every link issued for a deployment without rotating the auth key. */
export async function revokePreviewShareGrants(
  db: Database,
  deploymentId: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(previewShareGrants)
    .set({ revokedAt: now })
    .where(eq(previewShareGrants.deploymentId, deploymentId));
}
