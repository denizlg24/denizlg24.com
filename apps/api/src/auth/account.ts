import type { Database } from "@repo/cloud-core";
import {
  authOauthClient,
  authOauthConsent,
  authOauthRefreshToken,
  authTenant,
  authTenantMember,
  authUser,
} from "@repo/cloud-core/db/schema";
import type { AccountSummary, ConnectedApp } from "@repo/schemas/cloud";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { Hono } from "hono";

import type { CloudAuth } from "./better-auth";
import { type IdentityVariables, requireIdentity } from "./identity";
import { parseClientMetadata, tenantOfClientMetadata } from "./tenancy";

export interface AccountRouteOptions {
  auth: CloudAuth;
  db: Database;
  trustedOrigins?: readonly string[];
}

/** What any deniz account can see and undo about itself, cloud or public. */
export function accountRoutes(options: AccountRouteOptions) {
  const { db } = options;
  const app = new Hono<{ Variables: IdentityVariables }>();
  app.use("*", requireIdentity(options));

  app.get("/", async (context) => {
    const identity = context.get("identity");
    const [account, tenants] = await Promise.all([
      db.query.authUser.findFirst({
        columns: {
          email: true,
          emailVerified: true,
          name: true,
          username: true,
        },
        where: eq(authUser.id, identity.userId),
      }),
      db
        .select({ slug: authTenant.slug, name: authTenant.name })
        .from(authTenantMember)
        .innerJoin(authTenant, eq(authTenant.id, authTenantMember.tenantId))
        .where(eq(authTenantMember.userId, identity.userId)),
    ]);
    if (!account) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Account not found" } },
        404,
      );
    }
    const body: AccountSummary = {
      id: identity.userId,
      realm: identity.realm,
      username: account.username,
      email: account.email,
      emailVerified: account.emailVerified,
      name: account.name,
      twoFactorEnabled: identity.twoFactorEnabled,
      tenants,
      superuser: identity.superuser,
    };
    return context.json({ data: body });
  });

  app.get("/apps", async (context) => {
    const userId = context.get("identity").userId;
    const [consents, issued] = await Promise.all([
      db
        .select({
          clientId: authOauthConsent.clientId,
          scopes: authOauthConsent.scopes,
          createdAt: authOauthConsent.createdAt,
        })
        .from(authOauthConsent)
        .where(eq(authOauthConsent.userId, userId)),
      db
        .select({
          clientId: authOauthRefreshToken.clientId,
          last: max(authOauthRefreshToken.createdAt),
        })
        .from(authOauthRefreshToken)
        .where(
          and(
            eq(authOauthRefreshToken.userId, userId),
            isNull(authOauthRefreshToken.revoked),
          ),
        )
        .groupBy(authOauthRefreshToken.clientId),
    ]);
    const clientIds = [
      ...new Set([
        ...consents.map((row) => row.clientId),
        ...issued.map((row) => row.clientId),
      ]),
    ];
    if (clientIds.length === 0) return context.json({ data: [] });
    const clients = await db
      .select({
        clientId: authOauthClient.clientId,
        name: authOauthClient.name,
        uri: authOauthClient.uri,
        userId: authOauthClient.userId,
        metadata: authOauthClient.metadata,
      })
      .from(authOauthClient)
      .where(inArray(authOauthClient.clientId, clientIds));
    const tenantIds = clients
      .map((client) =>
        client.userId === null
          ? null
          : tenantOfClientMetadata(parseClientMetadata(client.metadata)),
      )
      .filter((id): id is string => id !== null);
    const tenants =
      tenantIds.length === 0
        ? []
        : await db
            .select({
              id: authTenant.id,
              slug: authTenant.slug,
              name: authTenant.name,
              logoUrl: authTenant.logoUrl,
            })
            .from(authTenant)
            .where(inArray(authTenant.id, tenantIds));
    const apps: ConnectedApp[] = clients.map((client) => {
      const consent = consents.find((row) => row.clientId === client.clientId);
      const last = issued.find((row) => row.clientId === client.clientId)?.last;
      const tenantId =
        client.userId === null
          ? null
          : tenantOfClientMetadata(parseClientMetadata(client.metadata));
      const tenant = tenants.find((row) => row.id === tenantId);
      return {
        clientId: client.clientId,
        name: client.name,
        uri: client.uri,
        tenant: tenant
          ? { slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl }
          : null,
        scopes: consent?.scopes ?? [],
        grantedAt: consent?.createdAt?.toISOString() ?? null,
        lastIssuedAt: last?.toISOString() ?? null,
      };
    });
    return context.json({ data: apps });
  });

  /** Signs this account out of one app and forgets the consent, so it asks again. */
  app.delete("/apps/:clientId", async (context) => {
    const userId = context.get("identity").userId;
    const clientId = context.req.param("clientId");
    await db.transaction(async (tx) => {
      await tx
        .update(authOauthRefreshToken)
        .set({ revoked: new Date() })
        .where(
          and(
            eq(authOauthRefreshToken.clientId, clientId),
            eq(authOauthRefreshToken.userId, userId),
            isNull(authOauthRefreshToken.revoked),
          ),
        );
      await tx
        .delete(authOauthConsent)
        .where(
          and(
            eq(authOauthConsent.clientId, clientId),
            eq(authOauthConsent.userId, userId),
          ),
        );
    });
    return context.json({ data: { clientId, revoked: true } });
  });

  return app;
}
