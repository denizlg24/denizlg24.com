import type { Database } from "@repo/cloud-core";
import {
  type AuthTenant,
  authOauthClient,
  authOauthConsent,
  authOauthRefreshToken,
  authOauthResource,
  authTenant,
  authTenantBlock,
  authTenantMember,
  authUser,
} from "@repo/cloud-core/db/schema";
import {
  addTenantMemberInputSchema,
  blockTenantUserInputSchema,
  createOAuthClientInputSchema,
  createTenantInputSchema,
  createTenantResourceInputSchema,
  type PublicTenant,
  type TenantDetail,
  type TenantMemberRole,
  type TenantSummary,
  type TenantUserList,
  updateOAuthClientInputSchema,
  updateTenantInputSchema,
} from "@repo/schemas/cloud";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  max,
  min,
  or,
} from "drizzle-orm";
import { Hono } from "hono";

import type { CloudAuth } from "./better-auth";
import { type IdentityVariables, requireIdentity } from "./identity";
import {
  assignableResources,
  listOAuthClients,
  registrationBody,
  setClientResources,
} from "./oauth-clients";
import {
  clientTenancy,
  parseClientMetadata,
  tenantOfClientMetadata,
  withTenantClientGrant,
} from "./tenancy";

export interface TenantRouteOptions {
  auth: CloudAuth;
  db: Database;
  trustedOrigins?: readonly string[];
}

const OWNER_DOMAIN = "denizlg24.com";

/** Tenant resources get short-lived tokens: revoking a grant only stops refreshes. */
const TENANT_ACCESS_TOKEN_SECONDS = 15 * 60;

type Access = "owner" | "admin" | "superuser";

function fail(code: string, message: string) {
  return { error: { code, message } } as const;
}

function notFound() {
  return fail("NOT_FOUND", "App not found");
}

async function tenantClientIds(
  db: Database,
  tenantId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      clientId: authOauthClient.clientId,
      userId: authOauthClient.userId,
      metadata: authOauthClient.metadata,
    })
    .from(authOauthClient);
  return rows
    .filter(
      (row) =>
        row.userId !== null &&
        tenantOfClientMetadata(parseClientMetadata(row.metadata)) === tenantId,
    )
    .map((row) => row.clientId);
}

/** People who hold a consent or a refresh token on any of these clients. */
function grantHolders(db: Database, clientIds: string[]) {
  return db
    .select({ userId: authOauthConsent.userId })
    .from(authOauthConsent)
    .where(inArray(authOauthConsent.clientId, clientIds))
    .union(
      db
        .select({ userId: authOauthRefreshToken.userId })
        .from(authOauthRefreshToken)
        .where(inArray(authOauthRefreshToken.clientId, clientIds)),
    );
}

async function summarize(
  db: Database,
  tenant: AuthTenant,
  access: Access,
): Promise<TenantSummary> {
  const clientIds = await tenantClientIds(db, tenant.id);
  const userCount =
    clientIds.length === 0
      ? 0
      : ((
          await db
            .select({ value: count() })
            .from(grantHolders(db, clientIds).as("holders"))
        )[0]?.value ?? 0);
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    logoUrl: tenant.logoUrl,
    homepageUrl: tenant.homepageUrl,
    privacyUrl: tenant.privacyUrl,
    termsUrl: tenant.termsUrl,
    signup: tenant.signup,
    mfa: tenant.mfa,
    requireVerifiedEmail: tenant.requireVerifiedEmail,
    disabled: tenant.disabled,
    access,
    clientCount: clientIds.length,
    userCount,
    createdAt: tenant.createdAt.toISOString(),
  };
}

export function publicTenant(tenant: AuthTenant): PublicTenant {
  return {
    slug: tenant.slug,
    name: tenant.name,
    logoUrl: tenant.logoUrl,
    homepageUrl: tenant.homepageUrl,
    privacyUrl: tenant.privacyUrl,
    termsUrl: tenant.termsUrl,
    signup: tenant.signup,
    mfa: tenant.mfa,
  };
}

async function revokeTenantGrants(
  db: Database,
  clientIds: string[],
  userId: string,
): Promise<void> {
  if (clientIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .update(authOauthRefreshToken)
      .set({ revoked: new Date() })
      .where(
        and(
          inArray(authOauthRefreshToken.clientId, clientIds),
          eq(authOauthRefreshToken.userId, userId),
          isNull(authOauthRefreshToken.revoked),
        ),
      );
    await tx
      .delete(authOauthConsent)
      .where(
        and(
          inArray(authOauthConsent.clientId, clientIds),
          eq(authOauthConsent.userId, userId),
        ),
      );
  });
}

/** Public: what the sign-in screens show about the app behind a client id. */
export function publicTenantRoutes(options: TenantRouteOptions) {
  const app = new Hono();
  app.get("/client/:clientId", async (context) => {
    const tenancy = await clientTenancy(
      options.db,
      context.req.param("clientId"),
    );
    if (!tenancy?.tenantId || tenancy.disabled) {
      return context.json(notFound(), 404);
    }
    const tenant = await options.db.query.authTenant.findFirst({
      where: eq(authTenant.id, tenancy.tenantId),
    });
    if (!tenant || tenant.disabled) return context.json(notFound(), 404);
    context.header("Cache-Control", "public, max-age=60");
    return context.json({ data: publicTenant(tenant) });
  });
  return app;
}

export function tenantRoutes(options: TenantRouteOptions) {
  const { db } = options;
  const app = new Hono<{
    Variables: IdentityVariables & { tenant: AuthTenant; access: Access };
  }>();

  // Managing an app means managing other people's access to it.
  app.use("*", requireIdentity(options, { twoFactor: true }));

  app.get("/", async (context) => {
    const identity = context.get("identity");
    const rows = identity.superuser
      ? (
          await db.select().from(authTenant).orderBy(desc(authTenant.createdAt))
        ).map((tenant) => ({ tenant, access: "superuser" as Access }))
      : (
          await db
            .select({ tenant: authTenant, role: authTenantMember.role })
            .from(authTenantMember)
            .innerJoin(authTenant, eq(authTenant.id, authTenantMember.tenantId))
            .where(eq(authTenantMember.userId, identity.userId))
            .orderBy(desc(authTenant.createdAt))
        ).map((row) => ({ tenant: row.tenant, access: row.role as Access }));
    return context.json({
      data: await Promise.all(
        rows.map((row) => summarize(db, row.tenant, row.access)),
      ),
    });
  });

  // Tenants are the owner's to hand out; there is no self-service.
  app.post("/", async (context) => {
    const identity = context.get("identity");
    if (!identity.superuser) {
      return context.json(
        fail("FORBIDDEN", "Only the owner creates apps"),
        403,
      );
    }
    const parsed = createTenantInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(fail("INVALID_INPUT", "Invalid app"), 400);
    }
    const now = new Date();
    const [created] = await db
      .insert(authTenant)
      .values({
        id: crypto.randomUUID(),
        ...parsed.data,
        createdBy: identity.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: authTenant.slug })
      .returning();
    if (!created) {
      return context.json(fail("CONFLICT", "That slug is taken"), 409);
    }
    return context.json(
      { data: await summarize(db, created, "superuser") },
      201,
    );
  });

  // Both patterns: `/:slug/*` does not reliably cover `/:slug` itself.
  for (const pattern of ["/:slug", "/:slug/*"]) {
    app.use(pattern, async (context, next) => {
      if (context.get("tenant")) return next();
      const identity = context.get("identity");
      const tenant = await db.query.authTenant.findFirst({
        where: eq(authTenant.slug, context.req.param("slug") ?? ""),
      });
      if (!tenant) return context.json(notFound(), 404);
      let access: Access | null = identity.superuser ? "superuser" : null;
      if (!access) {
        const member = await db.query.authTenantMember.findFirst({
          columns: { role: true },
          where: and(
            eq(authTenantMember.tenantId, tenant.id),
            eq(authTenantMember.userId, identity.userId),
          ),
        });
        access = member?.role ?? null;
      }
      // An app someone does not manage reads exactly like one that does not exist.
      if (!access) return context.json(notFound(), 404);
      context.set("tenant", tenant);
      context.set("access", access);
      return next();
    });
  }

  const canAdminister = (access: Access) =>
    access === "owner" || access === "superuser";

  app.get("/:slug", async (context) => {
    const tenant = context.get("tenant");
    const [summary, list, members] = await Promise.all([
      summarize(db, tenant, context.get("access")),
      listOAuthClients(db, { tenantId: tenant.id }),
      db
        .select({
          userId: authTenantMember.userId,
          role: authTenantMember.role,
          createdAt: authTenantMember.createdAt,
          username: authUser.username,
          email: authUser.email,
          name: authUser.name,
        })
        .from(authTenantMember)
        .innerJoin(authUser, eq(authUser.id, authTenantMember.userId))
        .where(eq(authTenantMember.tenantId, tenant.id))
        .orderBy(authTenantMember.createdAt),
    ]);
    const detail: TenantDetail = {
      tenant: summary,
      clients: list.clients,
      resources: list.resources,
      members: members.map((member) => ({
        ...member,
        createdAt: member.createdAt.toISOString(),
      })),
    };
    return context.json({ data: detail });
  });

  app.patch("/:slug", async (context) => {
    const access = context.get("access");
    if (!canAdminister(access)) {
      return context.json(
        fail("FORBIDDEN", "Only an owner can change this"),
        403,
      );
    }
    const parsed = updateTenantInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(fail("INVALID_INPUT", "Invalid update"), 400);
    }
    // Disabling a tenant is the service owner's lever, not the tenant's.
    if (parsed.data.disabled !== undefined && access !== "superuser") {
      return context.json(
        fail("FORBIDDEN", "Only the owner can disable an app"),
        403,
      );
    }
    const [updated] = await db
      .update(authTenant)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(authTenant.id, context.get("tenant").id))
      .returning();
    if (!updated) return context.json(notFound(), 404);
    return context.json({ data: await summarize(db, updated, access) });
  });

  app.delete("/:slug", async (context) => {
    if (context.get("access") !== "superuser") {
      return context.json(
        fail("FORBIDDEN", "Only the owner deletes apps"),
        403,
      );
    }
    const tenant = context.get("tenant");
    const clientIds = await tenantClientIds(db, tenant.id);
    await db.transaction(async (tx) => {
      // Cascades take the clients' tokens, consents and resource bindings.
      if (clientIds.length > 0) {
        await tx
          .delete(authOauthClient)
          .where(inArray(authOauthClient.clientId, clientIds));
      }
      await tx
        .delete(authOauthResource)
        .where(eq(authOauthResource.tenantId, tenant.id));
      await tx.delete(authTenant).where(eq(authTenant.id, tenant.id));
    });
    return context.json({ data: { slug: tenant.slug, deleted: true } });
  });

  app.post("/:slug/resources", async (context) => {
    if (!canAdminister(context.get("access"))) {
      return context.json(fail("FORBIDDEN", "Only an owner can add APIs"), 403);
    }
    const parsed = createTenantResourceInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(fail("INVALID_INPUT", "Invalid API"), 400);
    }
    // The owner's own domain is first-party ground. A tenant row there would
    // also outlive a first-party resource added later under the same
    // identifier, because the plugin seeds configured resources insert-only.
    const host = new URL(parsed.data.identifier).hostname.toLowerCase();
    if (host === OWNER_DOMAIN || host.endsWith(`.${OWNER_DOMAIN}`)) {
      return context.json(
        fail("INVALID_INPUT", "That address belongs to deniz auth itself"),
        400,
      );
    }
    const now = new Date();
    const [created] = await db
      .insert(authOauthResource)
      .values({
        id: crypto.randomUUID(),
        identifier: parsed.data.identifier,
        name: parsed.data.name,
        tenantId: context.get("tenant").id,
        accessTokenTtl: TENANT_ACCESS_TOKEN_SECONDS,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: authOauthResource.identifier })
      .returning({
        identifier: authOauthResource.identifier,
        name: authOauthResource.name,
      });
    if (!created) {
      return context.json(
        fail("CONFLICT", "That identifier is already registered"),
        409,
      );
    }
    return context.json({ data: created }, 201);
  });

  app.delete("/:slug/resources", async (context) => {
    if (!canAdminister(context.get("access"))) {
      return context.json(
        fail("FORBIDDEN", "Only an owner can remove APIs"),
        403,
      );
    }
    const identifier = context.req.query("identifier") ?? "";
    const [deleted] = await db
      .delete(authOauthResource)
      .where(
        and(
          eq(authOauthResource.identifier, identifier),
          eq(authOauthResource.tenantId, context.get("tenant").id),
        ),
      )
      .returning({ identifier: authOauthResource.identifier });
    if (!deleted) return context.json(fail("NOT_FOUND", "API not found"), 404);
    return context.json({ data: deleted });
  });

  app.post("/:slug/clients", async (context) => {
    const tenant = context.get("tenant");
    const identity = context.get("identity");
    const parsed = createOAuthClientInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(fail("INVALID_INPUT", "Invalid client"), 400);
    }
    const allowed = await assignableResources(db, tenant.id);
    if (!parsed.data.resources.every((resource) => allowed.has(resource))) {
      return context.json(fail("INVALID_INPUT", "Unknown API"), 400);
    }
    const created = await withTenantClientGrant(
      { userId: identity.userId, tenantId: tenant.id },
      () =>
        options.auth.api.adminCreateOAuthClient({
          headers: context.req.raw.headers,
          body: registrationBody(parsed.data, identity.userId, tenant.id),
        }),
    );
    if (parsed.data.kind !== "native" && !created.client_secret) {
      throw new Error("Confidential client was created without a secret");
    }
    await setClientResources(db, created.client_id, parsed.data.resources);
    return context.json(
      {
        data: {
          clientId: created.client_id,
          clientSecret: created.client_secret ?? null,
        },
      },
      201,
    );
  });

  async function ownClient(tenantId: string, clientId: string) {
    const tenancy = await clientTenancy(db, clientId);
    return tenancy?.tenantId === tenantId ? tenancy : null;
  }

  app.patch("/:slug/clients/:clientId", async (context) => {
    const clientId = context.req.param("clientId");
    if (!(await ownClient(context.get("tenant").id, clientId))) {
      return context.json(fail("NOT_FOUND", "Client not found"), 404);
    }
    const parsed = updateOAuthClientInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(fail("INVALID_INPUT", "Invalid update"), 400);
    }
    await db.transaction(async (tx) => {
      await tx
        .update(authOauthClient)
        .set({ disabled: parsed.data.disabled, updatedAt: new Date() })
        .where(eq(authOauthClient.clientId, clientId));
      if (parsed.data.disabled) {
        await tx
          .update(authOauthRefreshToken)
          .set({ revoked: new Date() })
          .where(
            and(
              eq(authOauthRefreshToken.clientId, clientId),
              isNull(authOauthRefreshToken.revoked),
            ),
          );
      }
    });
    return context.json({ data: { clientId, disabled: parsed.data.disabled } });
  });

  app.delete("/:slug/clients/:clientId", async (context) => {
    const clientId = context.req.param("clientId");
    if (!(await ownClient(context.get("tenant").id, clientId))) {
      return context.json(fail("NOT_FOUND", "Client not found"), 404);
    }
    await db
      .delete(authOauthClient)
      .where(eq(authOauthClient.clientId, clientId));
    return context.json({ data: { clientId, deleted: true } });
  });

  app.get("/:slug/users", async (context) => {
    const tenant = context.get("tenant");
    const limit = Math.min(
      Math.max(Number(context.req.query("limit") ?? 50) || 50, 1),
      200,
    );
    const offset = Math.max(Number(context.req.query("offset") ?? 0) || 0, 0);
    const q = context.req.query("q")?.trim();
    const clientIds = await tenantClientIds(db, tenant.id);
    if (clientIds.length === 0) {
      return context.json({ data: { users: [], total: 0 } });
    }
    const holders = grantHolders(db, clientIds).as("holders");
    const filter = and(
      inArray(authUser.id, db.select({ id: holders.userId }).from(holders)),
      q
        ? or(
            ilike(authUser.username, `%${q}%`),
            ilike(authUser.email, `%${q}%`),
          )
        : undefined,
    );
    const [page, totals] = await Promise.all([
      db
        .select({
          id: authUser.id,
          username: authUser.username,
          email: authUser.email,
          name: authUser.name,
          emailVerified: authUser.emailVerified,
          twoFactorEnabled: authUser.twoFactorEnabled,
        })
        .from(authUser)
        .where(filter)
        .orderBy(desc(authUser.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(authUser).where(filter),
    ]);
    const ids = page.map((row) => row.id);
    const [consents, tokens, blocks] =
      ids.length === 0
        ? [[], [], []]
        : await Promise.all([
            db
              .select({
                userId: authOauthConsent.userId,
                clientId: authOauthConsent.clientId,
                createdAt: authOauthConsent.createdAt,
              })
              .from(authOauthConsent)
              .where(
                and(
                  inArray(authOauthConsent.clientId, clientIds),
                  inArray(authOauthConsent.userId, ids),
                ),
              ),
            db
              .select({
                userId: authOauthRefreshToken.userId,
                clientId: authOauthRefreshToken.clientId,
                first: min(authOauthRefreshToken.createdAt),
                last: max(authOauthRefreshToken.createdAt),
              })
              .from(authOauthRefreshToken)
              .where(
                and(
                  inArray(authOauthRefreshToken.clientId, clientIds),
                  inArray(authOauthRefreshToken.userId, ids),
                ),
              )
              .groupBy(
                authOauthRefreshToken.userId,
                authOauthRefreshToken.clientId,
              ),
            db
              .select({ userId: authTenantBlock.userId })
              .from(authTenantBlock)
              .where(
                and(
                  eq(authTenantBlock.tenantId, tenant.id),
                  inArray(authTenantBlock.userId, ids),
                ),
              ),
          ]);
    const blocked = new Set(blocks.map((row) => row.userId));
    const earliest = (dates: (Date | null)[]) =>
      dates
        .filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const latest = (dates: (Date | null)[]) =>
      dates
        .filter((date): date is Date => date !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const body: TenantUserList = {
      total: totals[0]?.value ?? 0,
      users: page.map((user) => {
        const own = consents.filter((row) => row.userId === user.id);
        const issued = tokens.filter((row) => row.userId === user.id);
        const first = earliest([
          ...own.map((row) => row.createdAt),
          ...issued.map((row) => row.first),
        ]);
        const last = latest(issued.map((row) => row.last));
        return {
          ...user,
          twoFactorEnabled: user.twoFactorEnabled === true,
          clients: [
            ...new Set([
              ...own.map((row) => row.clientId),
              ...issued.map((row) => row.clientId),
            ]),
          ],
          firstGrantedAt: first?.toISOString() ?? null,
          lastIssuedAt: last?.toISOString() ?? null,
          blocked: blocked.has(user.id),
        };
      }),
    };
    return context.json({ data: body });
  });

  app.post("/:slug/users/:userId/block", async (context) => {
    const tenant = context.get("tenant");
    const userId = context.req.param("userId");
    const parsed = blockTenantUserInputSchema.safeParse(
      await context.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return context.json(fail("INVALID_INPUT", "Invalid reason"), 400);
    }
    const exists = await db.query.authUser.findFirst({
      columns: { id: true },
      where: eq(authUser.id, userId),
    });
    if (!exists) return context.json(fail("NOT_FOUND", "User not found"), 404);
    await db
      .insert(authTenantBlock)
      .values({
        tenantId: tenant.id,
        userId,
        reason: parsed.data.reason ?? null,
        createdBy: context.get("identity").userId,
      })
      .onConflictDoUpdate({
        target: [authTenantBlock.tenantId, authTenantBlock.userId],
        set: { reason: parsed.data.reason ?? null },
      });
    await revokeTenantGrants(db, await tenantClientIds(db, tenant.id), userId);
    return context.json({ data: { userId, blocked: true } });
  });

  app.delete("/:slug/users/:userId/block", async (context) => {
    await db
      .delete(authTenantBlock)
      .where(
        and(
          eq(authTenantBlock.tenantId, context.get("tenant").id),
          eq(authTenantBlock.userId, context.req.param("userId")),
        ),
      );
    return context.json({
      data: { userId: context.req.param("userId"), blocked: false },
    });
  });

  /** Signs someone out of every one of this tenant's apps; they may sign in again. */
  app.post("/:slug/users/:userId/revoke", async (context) => {
    const tenant = context.get("tenant");
    const userId = context.req.param("userId");
    await revokeTenantGrants(db, await tenantClientIds(db, tenant.id), userId);
    return context.json({ data: { userId, revoked: true } });
  });

  app.post("/:slug/members", async (context) => {
    const access = context.get("access");
    if (!canAdminister(access)) {
      return context.json(
        fail("FORBIDDEN", "Only an owner can add members"),
        403,
      );
    }
    const parsed = addTenantMemberInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(fail("INVALID_INPUT", "Invalid member"), 400);
    }
    const handle = parsed.data.account.toLowerCase();
    const account = await db.query.authUser.findFirst({
      columns: { id: true },
      where: or(eq(authUser.username, handle), eq(authUser.email, handle)),
    });
    if (!account) {
      return context.json(
        fail("NOT_FOUND", "No account with that username or email"),
        404,
      );
    }
    const role: TenantMemberRole = parsed.data.role;
    const tenantId = context.get("tenant").id;
    if (role !== "owner" && access !== "superuser") {
      const owners = await db
        .select({ userId: authTenantMember.userId })
        .from(authTenantMember)
        .where(
          and(
            eq(authTenantMember.tenantId, tenantId),
            eq(authTenantMember.role, "owner"),
          ),
        );
      if (owners.length === 1 && owners[0]?.userId === account.id) {
        return context.json(
          fail("CONFLICT", "An app keeps at least one owner"),
          409,
        );
      }
    }
    await db
      .insert(authTenantMember)
      .values({ tenantId, userId: account.id, role })
      .onConflictDoUpdate({
        target: [authTenantMember.tenantId, authTenantMember.userId],
        set: { role },
      });
    return context.json({ data: { userId: account.id, role } }, 201);
  });

  app.delete("/:slug/members/:userId", async (context) => {
    const access = context.get("access");
    const identity = context.get("identity");
    const userId = context.req.param("userId");
    // Anyone may leave; only an owner removes someone else.
    if (!canAdminister(access) && userId !== identity.userId) {
      return context.json(
        fail("FORBIDDEN", "Only an owner can remove members"),
        403,
      );
    }
    const tenantId = context.get("tenant").id;
    const owners = await db
      .select({ userId: authTenantMember.userId })
      .from(authTenantMember)
      .where(
        and(
          eq(authTenantMember.tenantId, tenantId),
          eq(authTenantMember.role, "owner"),
        ),
      );
    if (
      owners.length === 1 &&
      owners[0]?.userId === userId &&
      access !== "superuser"
    ) {
      return context.json(
        fail("CONFLICT", "An app keeps at least one owner"),
        409,
      );
    }
    await db
      .delete(authTenantMember)
      .where(
        and(
          eq(authTenantMember.tenantId, tenantId),
          eq(authTenantMember.userId, userId),
        ),
      );
    return context.json({ data: { userId, removed: true } });
  });

  return app;
}
