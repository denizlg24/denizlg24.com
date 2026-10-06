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
  authTenant,
  authVerification,
} from "@repo/cloud-core/db/schema";
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
const STATUS = "https://status.denizlg24.com";
const ACME_API = "https://api.acme.example";
const ACME_CALLBACK = "https://app.acme.example/auth/callback";

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
const credentialsSchema = z.object({
  data: z.object({ clientId: z.string(), clientSecret: z.string().nullable() }),
});

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .filter((cookie) => !/;\s*max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie) => cookie !== undefined)
    .join("; ");
}

async function pkce() {
  const verifier = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return {
    verifier,
    challenge: Buffer.from(new Uint8Array(digest)).toString("base64url"),
  };
}

function basic(clientId: string, secret: string | null): string {
  if (secret === null) throw new Error(`${clientId} is a public client`);
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`;
}

let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) await integrationDb.$client.end({ timeout: 5 });
});

describe("deniz auth tenants", () => {
  integrationTest(
    "admits public accounts to a tenant's apps and nowhere else",
    async () => {
      if (!integrationUrl) throw new Error("unreachable");
      if (!new URL(integrationUrl).pathname.endsWith("_auth_test")) {
        throw new Error("Integration database name must end in _auth_test");
      }
      const db = createDb(integrationUrl, { max: 1 });
      integrationDb = db;
      await db.execute(
        sql`TRUNCATE TABLE ${authVerification}, ${authUser}, ${users}, ${authOauthClient}, ${authOauthResource}, ${authJwks}, ${authTenant} CASCADE`,
      );

      const auth = createCloudAuth({
        baseURL: API,
        cookieDomain: ".denizlg24.com",
        db,
        secret: AUTH_SECRET,
        trustedOrigins: [AUTH_APP],
        oauth: {
          authAppUrl: AUTH_APP,
          resources: { api: API, web: WEB, mcp: MCP, status: STATUS },
        },
      });
      const app = createCloudApiApp({
        auth,
        db,
        oauth: { issuer: ISSUER, audience: API, authAppUrl: AUTH_APP },
        isProduction: true,
        rateLimitStore: new MemoryRateLimitStore(),
        trustedOrigins: [AUTH_APP],
      });
      const request = (path: string, init: RequestInit = {}) =>
        app.request(`${API}${path}`, init);
      const json = (
        method: string,
        path: string,
        cookie: string,
        body?: unknown,
      ) =>
        request(path, {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Cookie: cookie,
            Origin: AUTH_APP,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
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

      const seed = async (input: {
        username: string;
        realm: "cloud" | "public";
        superuser?: boolean;
        twoFactor: boolean;
        emailVerified: boolean;
      }): Promise<{ id: string; cookie: string }> => {
        const id = crypto.randomUUID();
        const password = `${input.username}-password-123`;
        const hash = await Bun.password.hash(password, {
          algorithm: "argon2id",
          memoryCost: 65_536,
          timeCost: 3,
        });
        const now = new Date();
        await db.insert(authUser).values({
          id,
          createdAt: now,
          displayUsername: input.username,
          email: `${input.username}@example.com`,
          emailVerified: input.emailVerified,
          name: input.username,
          realm: input.realm,
          role: input.superuser ? "admin" : "user",
          status: "active",
          twoFactorEnabled: false,
          updatedAt: now,
          username: input.username,
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
        if (input.realm === "cloud") {
          await db.insert(users).values({
            id,
            createdAt: now,
            email: `${input.username}@example.com`,
            passwordHash: hash,
            role: input.superuser ? "superuser" : "user",
            status: "active",
            totpEnabled: true,
            updatedAt: now,
            username: input.username,
          });
        }
        const signIn = await auth.api.signInUsername({
          body: { password, username: input.username },
          returnHeaders: true,
        });
        if (input.twoFactor) {
          await db
            .update(authUser)
            .set({ twoFactorEnabled: true })
            .where(eq(authUser.id, id));
        }
        return { id, cookie: cookieHeader(signIn.headers) };
      };

      const owner = await seed({
        username: "owner",
        realm: "cloud",
        superuser: true,
        twoFactor: true,
        emailVerified: true,
      });
      const developer = await seed({
        username: "dev",
        realm: "public",
        twoFactor: true,
        emailVerified: true,
      });
      const alice = await seed({
        username: "alice",
        realm: "public",
        twoFactor: false,
        emailVerified: true,
      });
      const bob = await seed({
        username: "bob",
        realm: "public",
        twoFactor: false,
        emailVerified: false,
      });

      // --- Tenants are the owner's to create. ---------------------------------
      expect(
        (
          await json("POST", "/api/tenants", developer.cookie, {
            slug: "acme",
            name: "Acme",
          })
        ).status,
      ).toBe(403);
      const noOrigin = await request("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "text/plain", Cookie: owner.cookie },
        body: JSON.stringify({ slug: "acme", name: "Acme" }),
      });
      expect(noOrigin.status).toBe(403);
      const createdTenant = await json("POST", "/api/tenants", owner.cookie, {
        slug: "acme",
        name: "Acme",
        signup: "open",
      });
      expect(createdTenant.status).toBe(201);
      const tenant = z
        .object({ data: z.object({ id: z.string(), mfa: z.string() }) })
        .parse(await createdTenant.json()).data;
      expect(tenant.mfa).toBe("optional");

      // A tenant someone does not manage reads as missing.
      expect(
        (await json("GET", "/api/tenants/acme", developer.cookie)).status,
      ).toBe(404);
      expect(
        (
          await json("POST", "/api/tenants/acme/members", owner.cookie, {
            account: "dev",
            role: "owner",
          })
        ).status,
      ).toBe(201);
      const developerTenants = z
        .object({
          data: z.array(z.object({ slug: z.string(), access: z.string() })),
        })
        .parse(
          await (await json("GET", "/api/tenants", developer.cookie)).json(),
        );
      expect(developerTenants.data).toEqual([
        expect.objectContaining({ slug: "acme", access: "owner" }),
      ]);

      // The only owner cannot be demoted by anyone but the service owner.
      expect(
        (
          await json("POST", "/api/tenants/acme/members", developer.cookie, {
            account: "dev",
            role: "admin",
          })
        ).status,
      ).toBe(409);
      // Device trust belongs to every account, public ones included.
      expect(
        (await json("GET", "/api/auth/trusted-devices", alice.cookie)).status,
      ).toBe(200);

      // --- The developer registers an API and clients. ------------------------
      expect(
        (
          await json("POST", "/api/tenants/acme/resources", developer.cookie, {
            identifier: ACME_API,
            name: "Acme API",
          })
        ).status,
      ).toBe(201);
      // The owner's own domain is not the tenant's to claim.
      expect(
        (
          await json("POST", "/api/tenants/acme/resources", developer.cookie, {
            identifier: "https://storage.denizlg24.com",
            name: "Squatted",
          })
        ).status,
      ).toBe(400);
      // A first-party resource is not the tenant's to bind.
      expect(
        (
          await json("POST", "/api/tenants/acme/clients", developer.cookie, {
            kind: "web",
            name: "Acme web",
            redirectUris: [ACME_CALLBACK],
            resources: [WEB],
          })
        ).status,
      ).toBe(400);
      const webClientResponse = await json(
        "POST",
        "/api/tenants/acme/clients",
        developer.cookie,
        {
          kind: "web",
          name: "Acme web",
          redirectUris: [ACME_CALLBACK],
          resources: [ACME_API],
        },
      );
      expect(webClientResponse.status).toBe(201);
      const acmeWeb = credentialsSchema.parse(
        await webClientResponse.json(),
      ).data;
      expect(acmeWeb.clientSecret).toBeString();

      // The owner's first-party view does not list tenant clients.
      const firstParty = z
        .object({
          data: z.object({
            clients: z.array(z.object({ clientId: z.string() })),
            resources: z.array(z.object({ identifier: z.string() })),
          }),
        })
        .parse(
          await (await json("GET", "/api/oauth/clients", owner.cookie)).json(),
        );
      expect(
        firstParty.data.clients.map((client) => client.clientId),
      ).not.toContain(acmeWeb.clientId);
      expect(
        firstParty.data.resources.map((resource) => resource.identifier),
      ).not.toContain(ACME_API);

      const publicView = await request(
        `/api/public/tenants/client/${acmeWeb.clientId}`,
      );
      expect(publicView.status).toBe(200);
      expect(
        z
          .object({ data: z.object({ name: z.string() }) })
          .parse(await publicView.json()).data.name,
      ).toBe("Acme");

      // --- A public account signs in to the tenant's app. ---------------------
      const jwks = z
        .object({ keys: z.array(z.record(z.string(), z.unknown())) })
        .parse(await (await request("/api/auth/jwks")).json());
      const verifyAcme = createAccessTokenVerifier({
        issuer: ISSUER,
        audience: ACME_API,
        keys: createLocalJWKSet(jwks),
      });

      const authorize = async (
        cookie: string,
        clientId: string,
        resource: string,
      ) => {
        const flow = await pkce();
        const query = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: ACME_CALLBACK,
          scope: "openid offline_access",
          resource,
          state: "acme-state",
          code_challenge: flow.challenge,
          code_challenge_method: "S256",
        });
        const response = await request(`/api/auth/oauth2/authorize?${query}`, {
          headers: { Cookie: cookie },
        });
        return { response, flow };
      };
      const refusal = (response: Response) => {
        expect(response.status).toBe(302);
        const location = new URL(response.headers.get("Location") ?? "");
        expect(`${location.origin}${location.pathname}`).toBe(
          `${AUTH_APP}/login`,
        );
        // The original request rides along so the auth app can resume it.
        expect(location.searchParams.get("client_id")).not.toBeNull();
        return location.searchParams.get("reason");
      };
      const signInToAcme = async (cookie: string, expectConsent: boolean) => {
        const { response, flow } = await authorize(
          cookie,
          acmeWeb.clientId,
          ACME_API,
        );
        expect(response.status).toBe(302);
        const location = new URL(response.headers.get("Location") ?? "");
        // Someone else's app always asks the first time, and remembers the answer.
        expect(location.pathname).toBe(
          expectConsent ? "/consent" : "/auth/callback",
        );
        let callback = location;
        if (expectConsent) {
          const consent = await json(
            "POST",
            "/api/auth/oauth2/consent",
            cookie,
            {
              accept: true,
              oauth_query: location.search.slice(1),
            },
          );
          expect(consent.status).toBe(200);
          callback = new URL(redirectSchema.parse(await consent.json()).url);
        }
        const exchanged = await tokenRequest(
          {
            grant_type: "authorization_code",
            code: callback.searchParams.get("code") ?? "",
            code_verifier: flow.verifier,
            redirect_uri: ACME_CALLBACK,
            resource: ACME_API,
          },
          basic(acmeWeb.clientId, acmeWeb.clientSecret),
        );
        expect(exchanged.status).toBe(200);
        return tokenSchema.parse(await exchanged.json());
      };

      const aliceTokens = await signInToAcme(alice.cookie, true);
      const aliceAccess = await verifyAcme(aliceTokens.access_token);
      expect(aliceAccess?.subject).toBe(alice.id);
      expect(aliceAccess?.claims.tenant).toBe(tenant.id);
      expect(aliceAccess?.claims.superuser).toBeUndefined();

      // A public account is not a cloud user, by cookie or by token.
      expect(
        (await request("/api/me", { headers: { Cookie: alice.cookie } }))
          .status,
      ).toBe(401);
      expect(
        (
          await request("/api/me", {
            headers: { Authorization: `Bearer ${aliceTokens.access_token}` },
          })
        ).status,
      ).toBe(401);

      // Nor can it reach a first-party client.
      const webClient = await json("POST", "/api/oauth/clients", owner.cookie, {
        kind: "web",
        name: "denizlg24.com",
        redirectUris: [`${WEB}/auth/callback`],
        resources: [WEB],
      });
      const firstPartyWeb = credentialsSchema.parse(
        await webClient.json(),
      ).data;
      const refused = await authorize(
        alice.cookie,
        firstPartyWeb.clientId,
        WEB,
      );
      expect(refusal(refused.response)).toBe("FORBIDDEN");

      // The owner using someone's app gets a tenant token, never a superuser one.
      const ownerTokens = await signInToAcme(owner.cookie, true);
      const ownerAccess = await verifyAcme(ownerTokens.access_token);
      expect(ownerAccess?.claims.tenant).toBe(tenant.id);
      expect(ownerAccess?.claims.superuser).toBeUndefined();

      // --- Policy gates hold at authorize and at refresh. ---------------------
      const refresh = (refreshToken: string) =>
        tokenRequest(
          {
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            resource: ACME_API,
          },
          basic(acmeWeb.clientId, acmeWeb.clientSecret),
        );

      const bobAttempt = await authorize(
        bob.cookie,
        acmeWeb.clientId,
        ACME_API,
      );
      expect(refusal(bobAttempt.response)).toBe("EMAIL_VERIFICATION_REQUIRED");

      expect(
        (
          await json("PATCH", "/api/tenants/acme", developer.cookie, {
            mfa: "required",
          })
        ).status,
      ).toBe(200);
      const mfaAttempt = await authorize(
        alice.cookie,
        acmeWeb.clientId,
        ACME_API,
      );
      expect(refusal(mfaAttempt.response)).toBe("MFA_ENROLLMENT_REQUIRED");
      expect((await refresh(aliceTokens.refresh_token ?? "")).ok).toBe(false);
      await json("PATCH", "/api/tenants/acme", developer.cookie, {
        mfa: "optional",
      });

      const aliceAgain = await signInToAcme(alice.cookie, false);
      const blocked = await json(
        "POST",
        `/api/tenants/acme/users/${alice.id}/block`,
        developer.cookie,
        { reason: "abuse" },
      );
      expect(blocked.status).toBe(200);
      expect((await refresh(aliceAgain.refresh_token ?? "")).ok).toBe(false);
      const blockedAttempt = await authorize(
        alice.cookie,
        acmeWeb.clientId,
        ACME_API,
      );
      expect(refusal(blockedAttempt.response)).toBe("TENANT_ACCESS_BLOCKED");
      await json(
        "DELETE",
        `/api/tenants/acme/users/${alice.id}/block`,
        developer.cookie,
      );

      // Only the service owner disables a tenant; doing so stops every refresh.
      // Blocking revoked her grants and forgot her consent, so she is asked again.
      const aliceThird = await signInToAcme(alice.cookie, true);
      expect(
        (
          await json("PATCH", "/api/tenants/acme", developer.cookie, {
            disabled: true,
          })
        ).status,
      ).toBe(403);
      await json("PATCH", "/api/tenants/acme", owner.cookie, {
        disabled: true,
      });
      expect((await refresh(aliceThird.refresh_token ?? "")).ok).toBe(false);
      await json("PATCH", "/api/tenants/acme", owner.cookie, {
        disabled: false,
      });

      // --- What the tenant and the person can see. ----------------------------
      const userList = z
        .object({
          data: z.object({
            total: z.number(),
            users: z.array(z.object({ id: z.string(), blocked: z.boolean() })),
          }),
        })
        .parse(
          await (
            await json("GET", "/api/tenants/acme/users", developer.cookie)
          ).json(),
        );
      expect(userList.data.users.map((user) => user.id)).toContain(alice.id);

      const aliceApps = z
        .object({
          data: z.array(
            z.object({
              clientId: z.string(),
              tenant: z.object({ slug: z.string() }).nullable(),
            }),
          ),
        })
        .parse(
          await (await json("GET", "/api/account/apps", alice.cookie)).json(),
        );
      expect(aliceApps.data).toEqual([
        expect.objectContaining({
          clientId: acmeWeb.clientId,
          tenant: expect.objectContaining({ slug: "acme" }),
        }),
      ]);
      const aliceFourth = await signInToAcme(alice.cookie, false);
      expect(
        (
          await json(
            "DELETE",
            `/api/account/apps/${acmeWeb.clientId}`,
            alice.cookie,
          )
        ).status,
      ).toBe(200);
      expect((await refresh(aliceFourth.refresh_token ?? "")).ok).toBe(false);

      // --- A tenant's service client acts as the tenant. ----------------------
      const serviceResponse = await json(
        "POST",
        "/api/tenants/acme/clients",
        developer.cookie,
        { kind: "service", name: "Acme worker", resources: [ACME_API] },
      );
      expect(serviceResponse.status).toBe(201);
      const service = credentialsSchema.parse(
        await serviceResponse.json(),
      ).data;
      const machine = await tokenRequest(
        {
          grant_type: "client_credentials",
          resource: ACME_API,
          scope: "service",
        },
        basic(service.clientId, service.clientSecret),
      );
      expect(machine.status).toBe(200);
      const machineAccess = await verifyAcme(
        tokenSchema.parse(await machine.json()).access_token,
      );
      expect(machineAccess?.machine).toBe(true);
      expect(machineAccess?.claims.tenant).toBe(tenant.id);
      expect(machineAccess?.claims.superuser).toBeUndefined();

      // --- Self-registration cannot claim a tenant. ---------------------------
      const forged = await request("/api/auth/oauth2/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Forged",
          redirect_uris: ["http://localhost:4000/callback"],
          token_endpoint_auth_method: "none",
          metadata: { tenant: tenant.id },
        }),
      });
      expect(forged.status).toBe(400);
    },
    60_000,
  );
});
