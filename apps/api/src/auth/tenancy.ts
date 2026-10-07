import { AsyncLocalStorage } from "node:async_hooks";

import type { Database } from "@repo/cloud-core";
import {
  authOauthClient,
  authTenant,
  authTenantBlock,
  authUser,
} from "@repo/cloud-core/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * A tenant client's tenant lives in its metadata next to `owner`, both
 * written only by our own client routes. Dynamic registration cannot set
 * metadata — `app.ts` refuses a registration body that tries.
 */
export function tenantOfClientMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const tenant = (metadata as Record<string, unknown>).tenant;
  return typeof tenant === "string" && tenant.length > 0 ? tenant : null;
}

/** The plugin stores metadata as a JSON string inside the jsonb column. */
export function parseClientMetadata(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export interface ClientTenancy {
  clientId: string;
  tenantId: string | null;
  disabled: boolean;
}

export async function clientTenancy(
  db: Database,
  clientId: string,
): Promise<ClientTenancy | null> {
  const row = await db.query.authOauthClient.findFirst({
    columns: { clientId: true, metadata: true, disabled: true, userId: true },
    where: eq(authOauthClient.clientId, clientId),
  });
  if (!row) return null;
  return {
    clientId: row.clientId,
    // A dynamically registered client has no creator; it is never a tenant's.
    tenantId:
      row.userId === null
        ? null
        : tenantOfClientMetadata(parseClientMetadata(row.metadata)),
    disabled: row.disabled === true,
  };
}

export type TenantAccessDenial =
  | "tenant_unavailable"
  | "account_inactive"
  | "blocked"
  | "mfa_required"
  | "email_unverified";

export type TenantAccess =
  | { ok: true }
  | { ok: false; reason: TenantAccessDenial };

export async function activeTenant(db: Database, tenantId: string) {
  const tenant = await db.query.authTenant.findFirst({
    where: eq(authTenant.id, tenantId),
  });
  return tenant && !tenant.disabled ? tenant : null;
}

/**
 * The one test every tenant grant is held to, at authorization, issuance and
 * every refresh: blocking someone or disabling the tenant cuts them off
 * within one access-token lifetime.
 */
export async function tenantAccess(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<TenantAccess> {
  const [tenant, account, block] = await Promise.all([
    activeTenant(db, tenantId),
    db.query.authUser.findFirst({
      columns: {
        banned: true,
        banExpires: true,
        emailVerified: true,
        status: true,
        twoFactorEnabled: true,
      },
      where: eq(authUser.id, userId),
    }),
    db.query.authTenantBlock.findFirst({
      columns: { userId: true },
      where: and(
        eq(authTenantBlock.tenantId, tenantId),
        eq(authTenantBlock.userId, userId),
      ),
    }),
  ]);
  if (!tenant) return { ok: false, reason: "tenant_unavailable" };
  const banned =
    account?.banned === true &&
    (!account.banExpires || account.banExpires.getTime() > Date.now());
  if (!account || account.status !== "active" || banned) {
    return { ok: false, reason: "account_inactive" };
  }
  if (block) return { ok: false, reason: "blocked" };
  if (tenant.mfa === "required" && account.twoFactorEnabled !== true) {
    return { ok: false, reason: "mfa_required" };
  }
  if (tenant.requireVerifiedEmail && !account.emailVerified) {
    return { ok: false, reason: "email_unverified" };
  }
  return { ok: true };
}

interface TenantClientGrant {
  userId: string;
  tenantId: string;
}

const clientGrants = new AsyncLocalStorage<TenantClientGrant>();

/**
 * The plugin asks `clientPrivileges` before creating a client and tells it
 * only who is asking, not for what. Our tenant routes check membership first
 * and then create the client inside this scope, which is the only way a
 * non-superuser's request can satisfy that hook. Nothing reachable over HTTP
 * enters it.
 */
export function withTenantClientGrant<T>(
  grant: TenantClientGrant,
  run: () => Promise<T>,
): Promise<T> {
  return clientGrants.run(grant, run);
}

export function currentTenantClientGrant(): TenantClientGrant | undefined {
  return clientGrants.getStore();
}
