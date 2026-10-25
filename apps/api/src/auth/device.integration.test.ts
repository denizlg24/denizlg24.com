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
  authDeviceCode,
  authJwks,
  authOauthClient,
  authOauthResource,
  authTenant,
  authTenantBlock,
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
const MACROS = "https://macros.denizlg24.com";
const FAMILY_API = "https://stream.example";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

class MemoryRateLimitStore implements PeekableRateLimitStore {
  async consume(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
  async peek(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
}

const deviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string(),
});
const oauthErrorSchema = z.object({ error: z.string() });

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .filter((cookie) => !/;\s*max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie) => cookie !== undefined)
    .join("; ");
}

let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) await integrationDb.$client.end({ timeout: 5 });
});

describe("device authorization", () => {
  integrationTest(
    "signs a TV in with a code a tenant's user approves elsewhere",
    async () => {
      if (!integrationUrl) throw new Error("unreachable");
      if (!new URL(integrationUrl).pathname.endsWith("_auth_test")) {
        throw new Error("Integration database name must end in _auth_test");
      }
      const db = createDb(integrationUrl, { max: 1 });
      integrationDb = db;
      await db.execute(
        sql`TRUNCATE TABLE ${authVerification}, ${authUser}, ${users}, ${authOauthClient}, ${authOauthResource}, ${authJwks}, ${authTenant}, ${authDeviceCode} CASCADE`,
      );

      const auth = createCloudAuth({
        baseURL: API,
        cookieDomain: ".denizlg24.com",
        db,
        secret: AUTH_SECRET,
        trustedOrigins: [AUTH_APP],
        oauth: {
          authAppUrl: AUTH_APP,
          resources: {
            api: API,
            web: WEB,
            mcp: MCP,
            status: STATUS,
            macros: MACROS,
          },
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
      const form = (path: string, params: Record<string, string>) =>
        request(path, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(params),
        });

      const seed = async (input: {
        username: string;
        realm: "cloud" | "public";
        superuser?: boolean;
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
          emailVerified: true,
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
        if (input.realm === "cloud") {
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
      });
      const alice = await seed({ username: "alice", realm: "public" });
      const mallory = await seed({ username: "mallory", realm: "public" });

      const tenant = z.object({ data: z.object({ id: z.string() }) }).parse(
        await (
          await json("POST", "/api/tenants", owner.cookie, {
            slug: "family",
            name: "Family",
            signup: "open",
          })
        ).json(),
      ).data;
      expect(
        (
          await json("POST", "/api/tenants/family/resources", owner.cookie, {
            identifier: FAMILY_API,
            name: "Stream",
          })
        ).status,
      ).toBe(201);
      const client = z
        .object({ data: z.object({ clientId: z.string() }) })
        .parse(
          await (
            await json("POST", "/api/tenants/family/clients", owner.cookie, {
              kind: "native",
              name: "Stream",
              redirectUris: ["com.example.stream:/oauth/callback"],
              resources: [FAMILY_API],
            })
          ).json(),
        ).data;
      const requestCode = () =>
        form("/api/auth/device/code", {
          client_id: client.clientId,
          scope: "openid offline_access",
          resource: FAMILY_API,
        });

      // --- Only a client allowed the grant may ask for a code. ----------------
      const refused = await requestCode();
      expect(refused.status).toBe(400);
      await db
        .update(authOauthClient)
        .set({
          grantTypes: sql`array_append(${authOauthClient.grantTypes}, ${DEVICE_GRANT})`,
        })
        .where(eq(authOauthClient.clientId, client.clientId));

      const issued = await requestCode();
      expect(issued.status).toBe(200);
      const code = deviceCodeSchema.parse(await issued.json());
      expect(code.verification_uri).toBe(`${AUTH_APP}/device`);
      expect(code.verification_uri_complete).toContain(code.user_code);

      const poll = (deviceCode: string) =>
        form("/api/auth/oauth2/token", {
          grant_type: DEVICE_GRANT,
          device_code: deviceCode,
          client_id: client.clientId,
          resource: FAMILY_API,
        });
      const pending = await poll(code.device_code);
      expect(pending.status).toBe(400);
      expect(oauthErrorSchema.parse(await pending.json()).error).toBe(
        "authorization_pending",
      );

      // --- The approving account claims the code, sees the client, approves. --
      const verified = await json(
        "GET",
        `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
        alice.cookie,
      );
      expect(verified.status).toBe(200);
      expect(
        z
          .object({ client_id: z.string(), status: z.string() })
          .parse(await verified.json()),
      ).toEqual({ client_id: client.clientId, status: "pending" });
      expect(
        (
          await json("POST", "/api/auth/device/approve", alice.cookie, {
            userCode: code.user_code,
          })
        ).status,
      ).toBe(200);

      // The plugin enforces the polling interval per code.
      await Bun.sleep(5_100);
      const tokens = await poll(code.device_code);
      expect(tokens.status).toBe(200);
      const body = z
        .object({ access_token: z.string(), refresh_token: z.string() })
        .parse(await tokens.json());
      const jwks = z
        .object({ keys: z.array(z.record(z.string(), z.unknown())) })
        .parse(await (await request("/api/auth/jwks")).json());
      const access = await createAccessTokenVerifier({
        issuer: ISSUER,
        audience: FAMILY_API,
        keys: createLocalJWKSet(jwks),
      })(body.access_token);
      expect(access?.subject).toBe(alice.id);
      expect(access?.claims.tenant).toBe(tenant.id);
      expect(access?.claims.superuser).toBeUndefined();

      const refreshed = await form("/api/auth/oauth2/token", {
        grant_type: "refresh_token",
        refresh_token: body.refresh_token,
        client_id: client.clientId,
        resource: FAMILY_API,
      });
      expect(refreshed.status).toBe(200);

      // --- An account the tenant refuses cannot approve. ----------------------
      await db
        .insert(authTenantBlock)
        .values({ tenantId: tenant.id, userId: mallory.id });
      const second = deviceCodeSchema.parse(await (await requestCode()).json());
      await json(
        "GET",
        `/api/auth/device?user_code=${encodeURIComponent(second.user_code)}`,
        mallory.cookie,
      );
      const blocked = await json(
        "POST",
        "/api/auth/device/approve",
        mallory.cookie,
        { userCode: second.user_code },
      );
      expect(blocked.status).toBe(403);
      const row = await db.query.authDeviceCode.findFirst({
        where: eq(authDeviceCode.deviceCode, second.device_code),
      });
      expect(row?.status).toBe("pending");
    },
    30_000,
  );
});
