import type { Database } from "@repo/cloud-core";
import {
  authOauthClient,
  authOauthConsent,
  authOauthRefreshToken,
  authTenant,
  authTenantMember,
  authUser,
} from "@repo/cloud-core/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { parseClientMetadata, tenantOfClientMetadata } from "./tenancy";

export interface TwoFactorDisableRefusal {
  code: "TWO_FACTOR_REQUIRED";
  message: string;
}

const refuse = (message: string): TwoFactorDisableRefusal => ({
  code: "TWO_FACTOR_REQUIRED",
  message,
});

/**
 * Whether this account may turn its authenticator app off. A cloud account
 * never may. A public account may, unless something it uses would stop
 * working the moment it did: managing an app needs a second factor, and so
 * does every app whose policy requires one — its next token refresh would be
 * refused.
 */
export async function twoFactorDisableRefusal(
  db: Database,
  userId: string,
): Promise<TwoFactorDisableRefusal | null> {
  const [account, membership, consents, grants] = await Promise.all([
    db.query.authUser.findFirst({
      columns: { realm: true },
      where: eq(authUser.id, userId),
    }),
    db.query.authTenantMember.findFirst({
      columns: { tenantId: true },
      where: eq(authTenantMember.userId, userId),
    }),
    db
      .select({ clientId: authOauthConsent.clientId })
      .from(authOauthConsent)
      .where(eq(authOauthConsent.userId, userId)),
    db
      .selectDistinct({ clientId: authOauthRefreshToken.clientId })
      .from(authOauthRefreshToken)
      .where(
        and(
          eq(authOauthRefreshToken.userId, userId),
          isNull(authOauthRefreshToken.revoked),
        ),
      ),
  ]);
  if (account?.realm !== "public") {
    return refuse("Two-factor authentication is mandatory");
  }
  if (membership) {
    return refuse(
      "You manage an app, and managing an app needs two-factor authentication",
    );
  }
  const clientIds = [
    ...new Set([...consents, ...grants].map((row) => row.clientId)),
  ];
  if (clientIds.length === 0) return null;
  const clients = await db
    .select({
      userId: authOauthClient.userId,
      metadata: authOauthClient.metadata,
    })
    .from(authOauthClient)
    .where(inArray(authOauthClient.clientId, clientIds));
  const tenantIds = [
    ...new Set(
      clients
        .map((client) =>
          client.userId === null
            ? null
            : tenantOfClientMetadata(parseClientMetadata(client.metadata)),
        )
        .filter((id): id is string => id !== null),
    ),
  ];
  if (tenantIds.length === 0) return null;
  const strict = await db
    .select({ name: authTenant.name })
    .from(authTenant)
    .where(
      and(
        inArray(authTenant.id, tenantIds),
        eq(authTenant.mfa, "required"),
        eq(authTenant.disabled, false),
      ),
    );
  const first = strict[0];
  if (!first) return null;
  const names = strict.map((tenant) => tenant.name);
  return refuse(
    names.length === 1
      ? `${first.name} requires two-factor authentication`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} require two-factor authentication`,
  );
}
