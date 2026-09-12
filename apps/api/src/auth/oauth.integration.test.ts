import { afterAll, describe, expect, it } from "bun:test";
import { createAccessTokenVerifier } from "@repo/cloud-auth-client/resource";
import {
  authAccount,
  authUser,
  CREDENTIAL_ACCOUNT_ISSUER,
  createDb,
  type PeekableRateLimitStore,
  type RateLimitDecision,
  users,
} from "@repo/cloud-core";
import {
  authJwks,
  authOauthClient,
  authOauthResource,
  authVerification,
} from "@repo/cloud-core/db/schema";
import { oauthClientCredentialsSchema } from "@repo/schemas/cloud";
import { eq, sql } from "drizzle-orm";
import { createLocalJWKSet } from "jose";
import { z } from "zod";

import { createCloudApiApp } from "../app";
import { createCloudAuth } from "./better-auth";

const integrationUrl = process.env.CLOUD_AUTH_FLOW_TEST_DATABASE_URL;
const integrationTest = integrationUrl ? it : it.skip;

const AUTH_SECRET =
  "integration-better-auth-secret-that-is-at-least-32-characters";
const API = "https://api.denizlg24.com";
const ISSUER = `${API}/api/auth`;
const AUTH_APP = "https://auth.denizlg24.com";
const WEB = "https://denizlg24.com";
const MCP = "https://mcp.denizlg24.com/mcp";

class MemoryRateLimitStore implements PeekableRateLimitStore {
  async consume(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
  async peek(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
}

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});
const redirectSchema = z.object({ redirect: z.literal(true), url: z.string() });

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie) => cookie !== undefined)
    .join("; ");
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function basic(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`;
}

let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) await integrationDb.$client.end({ timeout: 5 });
});

describe("cloud OAuth authorization server", () => {
  integrationTest(
    "issues resource-bound superuser tokens to MCP, service and web clients",
    async () => {
      if (!integrationUrl) throw new Error("unreachable");
      if (!new URL(integrationUrl).pathname.endsWith("_auth_test")) {
        throw new Error("Integration database name must end in _auth_test");
      }
      const db = createDb(integrationUrl, { max: 1 });
      integrationDb = db;
      await db.execute(
        sql`TRUNCATE TABLE ${authVerification}, ${authUser}, ${users}, ${authOauthClient}, ${authOauthResource}, ${authJwks} CASCADE`,
      );

      const auth = createCloudAuth({
        baseURL: API,
        cookieDomain: ".denizlg24.com",
        db,
        secret: AUTH_SECRET,
        trustedOrigins: [AUTH_APP],
        oauth: {
          authAppUrl: AUTH_APP,
          resources: { api: API, web: WEB, mcp: MCP },
        },
      });
      const app = createCloudApiApp({
        auth,
        db,
        oauth: { issuer: ISSUER, audience: API },
        isProduction: true,
        rateLimitStore: new MemoryRateLimitStore(),
        trustedOrigins: [AUTH_APP],
      });

      const seedUser = async (
        username: string,
        role: "superuser" | "user",
      ): Promise<{ id: string; cookie: string }> => {
        const id = crypto.randomUUID();
        const password = `${username}-password-123`;
        const hash = await Bun.password.hash(password, {
          algorithm: "argon2id",
          memoryCost: 65_536,
          timeCost: 3,
        });
        const now = new Date();
        await db.insert(authUser).values({
          id,
          createdAt: now,
          displayUsername: username,
          email: `${username}@example.com`,
          emailVerified: false,
          name: username,
          role: role === "superuser" ? "admin" : "user",
          status: "active",
          twoFactorEnabled: false,
          updatedAt: now,
          username,
        });
        await db.insert(authAccount).values({
          id: `credential:${id}`,
          accountId: id,
          createdAt: now,
          issuer: CREDENTIAL_ACCOUNT_ISSUER,
          password: hash,
          providerId: "credential",
          updatedAt: now,
          userId: id,
        });
        await db.insert(users).values({
          id,
          createdAt: now,
          email: `${username}@example.com`,
          passwordHash: hash,
          role,
          status: "active",
          totpEnabled: true,
          updatedAt: now,
          username,
        });
        const signIn = await auth.api.signInUsername({
          body: { password, username },
          returnHeaders: true,
        });
        await db
          .update(authUser)
          .set({ twoFactorEnabled: true })
          .where(eq(authUser.id, id));
        return { id, cookie: cookieHeader(signIn.headers) };
      };

      const owner = await seedUser("owner", "superuser");
      const request = (path: string, init: RequestInit = {}) =>
        app.request(`${API}${path}`, init);
      const tokenRequest = (
        params: Record<string, string>,
        authorization?: string,
      ) =>
        request("/api/auth/oauth2/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(authorization ? { Authorization: authorization } : {}),
          },
          body: new URLSearchParams(params),
        });

      // Discovery is served where MCP clients look for it, readable cross-origin.
      const metadata = await request(
        "/.well-known/oauth-authorization-server/api/auth",
      );
      expect(metadata.status).toBe(200);
      expect(metadata.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const metadataBody = z
        .object({ issuer: z.string(), registration_endpoint: z.string() })
        .parse(await metadata.json());
      expect(metadataBody.issuer).toBe(ISSUER);
      expect(metadataBody.registration_endpoint).toBe(
        `${ISSUER}/oauth2/register`,
      );

      // An MCP client registers itself the way Claude Code does: a loopback
      // callback and no application type.
      const registration = await request("/api/auth/oauth2/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude Code",
          redirect_uris: ["http://localhost:33418/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      expect(registration.status).toBe(201);
      const mcpClient = z
        .object({ client_id: z.string() })
        .parse(await registration.json());

      // Authorize with the owner's cloud session lands on the auth app's
      // consent page, carrying the signed request.
      const mcpPkce = await pkce();
      const authorizeQuery = new URLSearchParams({
        response_type: "code",
        client_id: mcpClient.client_id,
        redirect_uri: "http://localhost:33418/callback",
        scope: "openid offline_access",
        resource: MCP,
        state: "mcp-state",
        code_challenge: mcpPkce.challenge,
        code_challenge_method: "S256",
      });
      const authorize = await request(
        `/api/auth/oauth2/authorize?${authorizeQuery}`,
        { headers: { Cookie: owner.cookie } },
      );
      expect(authorize.status).toBe(302);
      const consentUrl = new URL(authorize.headers.get("Location") ?? "");
      expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(
        `${AUTH_APP}/consent`,
      );

      const consent = await request("/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: owner.cookie,
          Origin: AUTH_APP,
        },
        body: JSON.stringify({
          accept: true,
          oauth_query: consentUrl.search.slice(1),
        }),
      });
      expect(consent.status).toBe(200);
      const callback = new URL(redirectSchema.parse(await consent.json()).url);
      expect(callback.searchParams.get("state")).toBe("mcp-state");
      expect(callback.searchParams.get("iss")).toBe(ISSUER);

      const mcpTokens = tokenSchema.parse(
        await (
          await tokenRequest({
            grant_type: "authorization_code",
            client_id: mcpClient.client_id,
            code: callback.searchParams.get("code") ?? "",
            code_verifier: mcpPkce.verifier,
            redirect_uri: "http://localhost:33418/callback",
            resource: MCP,
          })
        ).json(),
      );
      expect(mcpTokens.refresh_token).toBeDefined();

      const jwks = z
        .object({ keys: z.array(z.record(z.string(), z.unknown())) })
        .parse(await (await request("/api/auth/jwks")).json());
      const keys = createLocalJWKSet(jwks);
      const verifyFor = (audience: string) =>
        createAccessTokenVerifier({ issuer: ISSUER, audience, keys });

      const mcpAccess = await verifyFor(MCP)(mcpTokens.access_token);
      expect(mcpAccess?.subject).toBe(owner.id);
      expect(mcpAccess?.claims.superuser).toBe(true);
      // Bound to the MCP server: the API itself refuses it.
      expect(await verifyFor(API)(mcpTokens.access_token)).toBeNull();
      const mcpAtApi = await request("/api/me", {
        headers: { Authorization: `Bearer ${mcpTokens.access_token}` },
      });
      expect(mcpAtApi.status).toBe(401);

      // The service client the MCP server runs as.
      const created = await request("/api/oauth/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: owner.cookie },
        body: JSON.stringify({
          kind: "service",
          name: "mcp",
          resources: [API, WEB],
        }),
      });
      expect(created.status).toBe(201);
      const service = oauthClientCredentialsSchema.parse(
        z.object({ data: z.unknown() }).parse(await created.json()).data,
      );
      const serviceAuth = basic(service.clientId, service.clientSecret);
      const machineToken = async (resource: string) =>
        tokenRequest(
          {
            grant_type: "client_credentials",
            resource,
            scope: "superuser",
          },
          serviceAuth,
        );

      const apiToken = tokenSchema.parse(
        await (await machineToken(API)).json(),
      );
      expect(apiToken.refresh_token).toBeUndefined();
      const apiAccess = await verifyFor(API)(apiToken.access_token);
      expect(apiAccess?.machine).toBe(true);
      expect(apiAccess?.claims.owner).toBe(owner.id);

      const me = await request("/api/me", {
        headers: { Authorization: `Bearer ${apiToken.access_token}` },
      });
      expect(me.status).toBe(200);
      expect(
        z
          .object({
            data: z.object({ username: z.string(), role: z.string() }),
          })
          .parse(await me.json()).data,
      ).toEqual({ username: "owner", role: "superuser" });

      const superuserRoute = await request("/api/auth/admin/users", {
        headers: { Authorization: `Bearer ${apiToken.access_token}` },
      });
      expect(superuserRoute.status).toBe(200);

      // A machine token cannot mint more clients.
      const escalation = await request("/api/oauth/clients", {
        headers: { Authorization: `Bearer ${apiToken.access_token}` },
      });
      expect(escalation.status).toBe(403);

      const webMachine = tokenSchema.parse(
        await (await machineToken(WEB)).json(),
      );
      expect((await verifyFor(WEB)(webMachine.access_token))?.machine).toBe(
        true,
      );
      // Not linked to the MCP resource, so it cannot pose as an MCP client.
      expect((await machineToken(MCP)).status).toBe(400);

      // Demoting the owner cuts the service client off at once, not at expiry.
      await db
        .update(users)
        .set({ role: "user" })
        .where(eq(users.id, owner.id));
      const demoted = await request("/api/me", {
        headers: { Authorization: `Bearer ${apiToken.access_token}` },
      });
      expect(demoted.status).toBe(401);
      expect((await machineToken(API)).status).toBe(403);
      await db
        .update(users)
        .set({ role: "superuser" })
        .where(eq(users.id, owner.id));

      // This site's own client: trusted, so no consent step.
      const createdWeb = await request("/api/oauth/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: owner.cookie },
        body: JSON.stringify({
          kind: "web",
          name: "denizlg24.com",
          redirectUris: [`${WEB}/auth/callback`],
          resources: [WEB],
        }),
      });
      expect(createdWeb.status).toBe(201);
      const site = oauthClientCredentialsSchema.parse(
        z.object({ data: z.unknown() }).parse(await createdWeb.json()).data,
      );
      const sitePkce = await pkce();
      const siteAuthorize = await request(
        `/api/auth/oauth2/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: site.clientId,
          redirect_uri: `${WEB}/auth/callback`,
          scope: "openid offline_access",
          resource: WEB,
          state: "site-state",
          code_challenge: sitePkce.challenge,
          code_challenge_method: "S256",
        })}`,
        { headers: { Cookie: owner.cookie } },
      );
      expect(siteAuthorize.status).toBe(302);
      const siteCallback = new URL(siteAuthorize.headers.get("Location") ?? "");
      expect(`${siteCallback.origin}${siteCallback.pathname}`).toBe(
        `${WEB}/auth/callback`,
      );
      const siteTokens = tokenSchema.parse(
        await (
          await tokenRequest(
            {
              grant_type: "authorization_code",
              code: siteCallback.searchParams.get("code") ?? "",
              code_verifier: sitePkce.verifier,
              redirect_uri: `${WEB}/auth/callback`,
              resource: WEB,
            },
            basic(site.clientId, site.clientSecret),
          )
        ).json(),
      );
      expect(
        (await verifyFor(WEB)(siteTokens.access_token))?.claims.superuser,
      ).toBe(true);

      // A request that still carries the pre-rotation cookie replays the old
      // refresh token; inside the grace window that answers with the same
      // tokens instead of revoking the grant as a stolen-token replay.
      const refresh = () =>
        tokenRequest(
          {
            grant_type: "refresh_token",
            refresh_token: siteTokens.refresh_token ?? "",
            resource: WEB,
          },
          basic(site.clientId, site.clientSecret),
        );
      const first = await refresh();
      expect(first.status).toBe(200);
      const rotated = tokenSchema.parse(await first.json());
      expect(rotated.refresh_token).not.toBe(siteTokens.refresh_token);
      const replay = await refresh();
      expect(replay.status).toBe(200);
      expect(tokenSchema.parse(await replay.json()).refresh_token).toBe(
        rotated.refresh_token,
      );

      // Disabling the service client stops it minting anything.
      const disabled = await request(
        `/api/oauth/clients/${encodeURIComponent(service.clientId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: owner.cookie },
          body: JSON.stringify({ disabled: true }),
        },
      );
      expect(disabled.status).toBe(200);
      expect((await machineToken(API)).ok).toBe(false);

      const listed = await request("/api/oauth/clients", {
        headers: { Cookie: owner.cookie },
      });
      expect(listed.status).toBe(200);
      const list = z
        .object({
          data: z.object({
            clients: z.array(
              z.object({
                clientId: z.string(),
                kind: z.string(),
                resources: z.array(z.string()),
                disabled: z.boolean(),
              }),
            ),
          }),
        })
        .parse(await listed.json()).data.clients;
      const byId = new Map(list.map((client) => [client.clientId, client]));
      expect(byId.get(mcpClient.client_id)?.kind).toBe("dynamic");
      expect(byId.get(mcpClient.client_id)?.resources).toEqual([MCP]);
      expect(byId.get(service.clientId)?.kind).toBe("service");
      expect(byId.get(service.clientId)?.disabled).toBe(true);
      expect(byId.get(service.clientId)?.resources.sort()).toEqual(
        [API, WEB].sort(),
      );
      expect(byId.get(site.clientId)?.resources).toEqual([WEB]);

      // A signed-in account that is not a superuser never gets a code.
      const member = await seedUser("member", "user");
      const refused = await request(
        `/api/auth/oauth2/authorize?${authorizeQuery}`,
        { headers: { Cookie: member.cookie } },
      );
      expect(refused.status).toBe(403);
    },
    60_000,
  );
});
