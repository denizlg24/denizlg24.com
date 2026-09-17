import { authVerification, type Database } from "@repo/cloud-core";
import type {
  TrustedDevicesRevoked,
  TrustedDevicesSummary,
} from "@repo/schemas/cloud";
import { and, eq, gt, like } from "drizzle-orm";

// Better Auth's twoFactor plugin records a trusted device as a verification
// row: identifier `trust-device-<random>`, value the user id, expiry the
// cookie's. The cookie carries an HMAC over `<userId>!<identifier>` and is
// only honoured while the row exists, so deleting the rows is the revoke the
// plugin does not expose.
const TRUST_DEVICE_IDENTIFIER_PREFIX = "trust-device-";

function ownedTrustRows(userId: string) {
  return and(
    like(authVerification.identifier, `${TRUST_DEVICE_IDENTIFIER_PREFIX}%`),
    eq(authVerification.value, userId),
  );
}

export async function summarizeTrustedDevices(
  db: Database,
  userId: string,
): Promise<TrustedDevicesSummary> {
  const rows = await db
    .select({ expiresAt: authVerification.expiresAt })
    .from(authVerification)
    .where(
      and(ownedTrustRows(userId), gt(authVerification.expiresAt, new Date())),
    )
    .orderBy(authVerification.expiresAt);
  return {
    count: rows.length,
    nextExpiresAt: rows[0]?.expiresAt.toISOString() ?? null,
  };
}

export async function revokeTrustedDevices(
  db: Database,
  userId: string,
): Promise<TrustedDevicesRevoked> {
  const deleted = await db
    .delete(authVerification)
    .where(ownedTrustRows(userId))
    .returning({ id: authVerification.id });
  return { revoked: deleted.length };
}
