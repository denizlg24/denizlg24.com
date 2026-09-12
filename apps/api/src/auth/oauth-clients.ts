import type { AuthVariables, Database } from "@repo/cloud-core";
import {
  authOauthClient,
  authOauthClientResource,
  authOauthRefreshToken,
  authOauthResource,
} from "@repo/cloud-core/db/schema";
import {
  type CreateOAuthClientInput,
  createOAuthClientInputSchema,
  OAUTH_SUPERUSER_SCOPE,
  type OAuthClientKind,
  type OAuthClientList,
  updateOAuthClientInputSchema,
} from "@repo/schemas/cloud";
import { and, desc, eq, isNull, max, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { CloudAuth } from "./better-auth";

export interface OAuthClientRouteOptions {
  auth: CloudAuth;
  db: Database;
}

function clientKind(row: {
  userId: string | null;
  grantTypes: string[] | null;
  tokenEndpointAuthMethod: string | null;
}): OAuthClientKind {
  if (row.userId === null) return "dynamic";
  if (row.grantTypes?.includes("client_credentials")) return "service";
  return row.tokenEndpointAuthMethod === "none" ? "native" : "web";
}

export async function listOAuthClients(db: Database): Promise<OAuthClientList> {
  const [clients, links, grants, resources] = await Promise.all([
    db
      .select({
        clientId: authOauthClient.clientId,
        name: authOauthClient.name,
        userId: authOauthClient.userId,
        grantTypes: authOauthClient.grantTypes,
        tokenEndpointAuthMethod: authOauthClient.tokenEndpointAuthMethod,
        redirectUris: authOauthClient.redirectUris,
        disabled: authOauthClient.disabled,
        createdAt: authOauthClient.createdAt,
      })
      .from(authOauthClient)
      .orderBy(desc(authOauthClient.createdAt)),
    db
      .select({
        clientId: authOauthClientResource.clientId,
        resourceId: authOauthClientResource.resourceId,
      })
      .from(authOauthClientResource),
    db
      .select({
        clientId: authOauthRefreshToken.clientId,
        active:
          sql<number>`count(*) filter (where ${authOauthRefreshToken.revoked} is null and ${authOauthRefreshToken.expiresAt} > now())`.mapWith(
            Number,
          ),
        lastIssuedAt: max(authOauthRefreshToken.createdAt),
      })
      .from(authOauthRefreshToken)
      .groupBy(authOauthRefreshToken.clientId),
    db
      .select({
        identifier: authOauthResource.identifier,
        name: authOauthResource.name,
      })
      .from(authOauthResource)
      .where(eq(authOauthResource.disabled, false)),
  ]);
  const resourcesByClient = new Map<string, string[]>();
  for (const link of links) {
    const list = resourcesByClient.get(link.clientId) ?? [];
    list.push(link.resourceId);
    resourcesByClient.set(link.clientId, list);
  }
  const grantsByClient = new Map(grants.map((row) => [row.clientId, row]));
  return {
    clients: clients.map((row) => {
      const grant = grantsByClient.get(row.clientId);
      return {
        clientId: row.clientId,
        name: row.name,
        kind: clientKind(row),
        redirectUris: row.redirectUris,
        resources: resourcesByClient.get(row.clientId) ?? [],
        disabled: row.disabled === true,
        activeGrants: grant?.active ?? 0,
        lastIssuedAt: grant?.lastIssuedAt?.toISOString() ?? null,
        createdAt: row.createdAt?.toISOString() ?? null,
      };
    }),
    resources,
  };
}

/**
 * Registration links every client to the server's default resource (MCP), so
 * a first-party client is reset to exactly what it asked for — a web client
 * able to request MCP tokens is a capability nobody chose.
 */
async function setClientResources(
  db: Database,
  clientId: string,
  resources: readonly string[],
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(authOauthClientResource)
      .where(
        and(
          eq(authOauthClientResource.clientId, clientId),
          notInArray(authOauthClientResource.resourceId, [...resources]),
        ),
      );
    await tx
      .insert(authOauthClientResource)
      .values(
        resources.map((resourceId) => ({
          id: crypto.randomUUID(),
          clientId,
          resourceId,
          createdAt: new Date(),
        })),
      )
      .onConflictDoNothing();
  });
}

function registrationBody(input: CreateOAuthClientInput, ownerId: string) {
  const metadata = { owner: ownerId };
  if (input.kind === "service") {
    return {
      client_name: input.name,
      grant_types: ["client_credentials"],
      token_endpoint_auth_method: "client_secret_basic",
      scope: OAUTH_SUPERUSER_SCOPE,
      client_credentials_scopes: [OAUTH_SUPERUSER_SCOPE],
      metadata,
    };
  }
  const loopbackOnly = input.redirectUris.some(
    (uri) => new URL(uri).protocol === "http:",
  );
  const native = input.kind === "native" || loopbackOnly;
  return {
    client_name: input.name,
    redirect_uris: input.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code" as const],
    // A native client is public: the plugin issues no secret and requires
    // PKCE, so the binary that ships it holds nothing worth extracting.
    token_endpoint_auth_method:
      input.kind === "native" ? "none" : "client_secret_basic",
    application_type: native ? ("native" as const) : ("web" as const),
    scope: "openid profile email offline_access",
    skip_consent: true,
    require_pkce: true,
    metadata,
  };
}

function badRequest(message: string) {
  return { error: { code: "INVALID_INPUT", message } } as const;
}

export function oauthClientRoutes(options: OAuthClientRouteOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Minting and rotating credentials takes a person at a browser. A token the
  // authorization server issued is superuser-equivalent everywhere else, but
  // letting it create more clients would make one leaked secret unbounded.
  app.use("*", async (context, next) => {
    if (context.get("sessionId")?.startsWith("oauth:")) {
      return context.json(
        {
          error: {
            code: "SESSION_REQUIRED",
            message: "A human session is required",
          },
        },
        403,
      );
    }
    return next();
  });

  app.get("/clients", async (context) =>
    context.json({ data: await listOAuthClients(options.db) }),
  );

  app.post("/clients", async (context) => {
    const parsed = createOAuthClientInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(badRequest("Invalid client"), 400);
    }
    const configured = new Set(
      (
        await options.db
          .select({ identifier: authOauthResource.identifier })
          .from(authOauthResource)
          .where(eq(authOauthResource.disabled, false))
      ).map((row) => row.identifier),
    );
    if (!parsed.data.resources.every((resource) => configured.has(resource))) {
      return context.json(badRequest("Unknown resource"), 400);
    }
    const created = await options.auth.api.adminCreateOAuthClient({
      headers: context.req.raw.headers,
      body: registrationBody(parsed.data, context.get("user").id),
    });
    if (parsed.data.kind !== "native" && !created.client_secret) {
      throw new Error("Confidential client was created without a secret");
    }
    await setClientResources(
      options.db,
      created.client_id,
      parsed.data.resources,
    );
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

  app.post("/clients/:clientId/rotate-secret", async (context) => {
    const rotated = await options.auth.api.rotateClientSecret({
      headers: context.req.raw.headers,
      body: { client_id: context.req.param("clientId") },
    });
    if (!rotated.client_secret) {
      throw new Error("Rotation returned no secret");
    }
    return context.json({
      data: {
        clientId: rotated.client_id,
        clientSecret: rotated.client_secret,
      },
    });
  });

  // Direct rather than through the plugin: its update endpoint only lets an
  // owner touch a client, and a dynamically registered MCP client has none —
  // which would leave exactly the clients most worth cutting off uncuttable.
  app.patch("/clients/:clientId", async (context) => {
    const parsed = updateOAuthClientInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(badRequest("Invalid update"), 400);
    }
    const clientId = context.req.param("clientId");
    const found = await options.db.transaction(async (tx) => {
      const [row] = await tx
        .update(authOauthClient)
        .set({ disabled: parsed.data.disabled, updatedAt: new Date() })
        .where(eq(authOauthClient.clientId, clientId))
        .returning({ clientId: authOauthClient.clientId });
      if (!row) return false;
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
      return true;
    });
    if (!found) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Client not found" } },
        404,
      );
    }
    return context.json({ data: { clientId, disabled: parsed.data.disabled } });
  });

  return app;
}
