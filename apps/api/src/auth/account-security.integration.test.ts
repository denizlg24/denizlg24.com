import { afterAll, describe, expect, it } from "bun:test";
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
  authOauthConsent,
  authOauthResource,
  authTenant,
  authTenantMember,
  authTwoFactor,
  authVerification,
} from "@repo/cloud-core/db/schema";
import { symmetricDecrypt } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
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
const APP_CALLBACK = "https://app.acme.example/auth/callback";

class MemoryRateLimitStore implements PeekableRateLimitStore {
  async consume(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
  async peek(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
}

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .filter((cookie) => !/;\s*max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie) => cookie !== undefined)
    .join("; ");
}

function mergeCookies(current: string, update: string): string {
  const jar = new Map<string, string>();
  for (const part of [...current.split("; "), ...update.split("; ")]) {
    const index = part.indexOf("=");
    if (index > 0) jar.set(part.slice(0, index), part);
  }
  return [...jar.values()].join("; ");
}

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) await integrationDb.$client.end({ timeout: 5 });
});

describe("account security for public accounts", () => {
  integrationTest(
    "changes name and password, turns two-factor on and off, and confirms return links",
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
      });
      const app = createCloudApiApp({
        auth,
        db,
        oauth: { issuer: ISSUER, audience: API, authAppUrl: AUTH_APP },
        isProduction: true,
        rateLimitStore: new MemoryRateLimitStore(),
        trustedOrigins: [AUTH_APP],
      });
      const post = (path: string, cookie: string, body: unknown) =>
        app.request(`${API}${path}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Cookie: cookie,
            Origin: AUTH_APP,
          },
          body: JSON.stringify(body),
        });
      const signIn = async (username: string, password: string) => {
        const result = await auth.api.signInUsername({
          body: { password, username },
          returnHeaders: true,
        });
        return cookieHeader(result.headers);
      };

      const seed = async (input: {
        username: string;
        realm: "cloud" | "public";
        twoFactor: boolean;
      }): Promise<{ id: string; password: string; cookie: string }> => {
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
          role: input.realm === "cloud" ? "admin" : "user",
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
            role: "superuser",
            status: "active",
            totpEnabled: true,
            updatedAt: now,
            username: input.username,
          });
        }
        const cookie = await signIn(input.username, password);
        if (input.twoFactor) {
          await db
            .update(authUser)
            .set({ twoFactorEnabled: true })
            .where(eq(authUser.id, id));
        }
        return { id, password, cookie };
      };

      const owner = await seed({
        username: "owner",
        realm: "cloud",
        twoFactor: true,
      });
      const developer = await seed({
        username: "dev",
        realm: "public",
        twoFactor: true,
      });
      const alice = await seed({
        username: "alice",
        realm: "public",
        twoFactor: false,
      });

      // --- Profile name. ---------------------------------------------------
      expect(
        (await post("/api/auth/update-user", alice.cookie, { name: "Alice L" }))
          .status,
      ).toBe(200);
      expect(
        (
          await db.query.authUser.findFirst({
            columns: { name: true },
            where: eq(authUser.id, alice.id),
          })
        )?.name,
      ).toBe("Alice L");
      // The realm is not the account's to change.
      await post("/api/auth/update-user", alice.cookie, { realm: "cloud" });
      expect(
        (
          await db.query.authUser.findFirst({
            columns: { realm: true },
            where: eq(authUser.id, alice.id),
          })
        )?.realm,
      ).toBe("public");

      // --- Password. -------------------------------------------------------
      expect(
        (
          await post("/api/auth/change-password", alice.cookie, {
            currentPassword: "not-the-password",
            newPassword: "alice-new-password-456",
          })
        ).status,
      ).toBe(400);
      const changed = await post("/api/auth/change-password", alice.cookie, {
        currentPassword: alice.password,
        newPassword: "alice-new-password-456",
        revokeOtherSessions: true,
      });
      expect(changed.status).toBe(200);
      const aliceCookie = mergeCookies(
        alice.cookie,
        cookieHeader(changed.headers),
      );
      await expect(signIn("alice", alice.password)).rejects.toThrow();
      expect(await signIn("alice", "alice-new-password-456")).not.toBe("");

      // --- Two-factor on. --------------------------------------------------
      const enable = await post("/api/auth/two-factor/enable", aliceCookie, {
        password: "alice-new-password-456",
      });
      expect(enable.status).toBe(200);
      const enabled = z
        .object({ totpURI: z.string(), backupCodes: z.array(z.string()) })
        .parse(await enable.json());
      expect(enabled.backupCodes).toHaveLength(10);
      const stored = await db.query.authTwoFactor.findFirst({
        where: eq(authTwoFactor.userId, alice.id),
      });
      if (!stored) throw new Error("TOTP enrollment was not stored");
      const generated = await auth.api.generateTOTP({
        body: {
          secret: await symmetricDecrypt({
            data: stored.secret,
            key: AUTH_SECRET,
          }),
        },
      });
      const verify = await post(
        "/api/auth/two-factor/verify-totp",
        aliceCookie,
        {
          code: generated.code,
        },
      );
      expect(verify.status).toBe(200);
      const enrolledCookie = mergeCookies(
        aliceCookie,
        cookieHeader(verify.headers),
      );
      const twoFactorOf = async (id: string) =>
        (
          await db.query.authUser.findFirst({
            columns: { twoFactorEnabled: true },
            where: eq(authUser.id, id),
          })
        )?.twoFactorEnabled;
      expect(await twoFactorOf(alice.id)).toBe(true);

      // --- Two-factor off, held to the apps that need it. ------------------
      const now = new Date();
      await db.insert(authTenant).values({
        id: "tenant-strict",
        slug: "strict",
        name: "Strict",
        mfa: "required",
        signup: "open",
      });
      await db.insert(authOauthClient).values({
        id: "client-strict",
        clientId: "client-strict",
        createdAt: now,
        updatedAt: now,
        name: "Strict web",
        redirectUris: [APP_CALLBACK, "http://localhost:3013/auth/callback"],
        userId: developer.id,
        metadata: { tenant: "tenant-strict" },
      });
      await db.insert(authOauthClient).values({
        id: "client-first-party",
        clientId: "client-first-party",
        createdAt: now,
        updatedAt: now,
        name: "First party",
        redirectUris: ["https://forge.denizlg24.com/auth/callback"],
        userId: owner.id,
      });
      await db.insert(authOauthConsent).values({
        id: crypto.randomUUID(),
        clientId: "client-strict",
        userId: alice.id,
        scopes: ["openid"],
        createdAt: now,
        updatedAt: now,
      });
      const strictRefusal = await post(
        "/api/auth/two-factor/disable",
        enrolledCookie,
        { password: "alice-new-password-456" },
      );
      expect(strictRefusal.status).toBe(403);
      expect(errorSchema.parse(await strictRefusal.json()).error).toEqual({
        code: "TWO_FACTOR_REQUIRED",
        message: "Strict requires two-factor authentication",
      });
      await db
        .delete(authOauthConsent)
        .where(eq(authOauthConsent.userId, alice.id));

      expect(
        (
          await post("/api/auth/two-factor/disable", enrolledCookie, {
            password: "wrong-password-000",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post("/api/auth/two-factor/disable", enrolledCookie, {
            password: "alice-new-password-456",
          })
        ).status,
      ).toBe(200);
      expect(await twoFactorOf(alice.id)).toBe(false);

      // A cloud account never loses its second factor; neither does someone
      // who manages an app.
      const ownerRefusal = await post(
        "/api/auth/two-factor/disable",
        owner.cookie,
        { password: owner.password },
      );
      expect(ownerRefusal.status).toBe(403);
      expect(errorSchema.parse(await ownerRefusal.json()).error.message).toBe(
        "Two-factor authentication is mandatory",
      );
      await db.insert(authTenantMember).values({
        tenantId: "tenant-strict",
        userId: developer.id,
        role: "owner",
      });
      expect(
        (
          await post("/api/auth/two-factor/disable", developer.cookie, {
            password: developer.password,
          })
        ).status,
      ).toBe(403);
      expect(await twoFactorOf(owner.id)).toBe(true);
      expect(await twoFactorOf(developer.id)).toBe(true);

      // --- Return links. ---------------------------------------------------
      const returnLink = (clientId: string, to: string) =>
        app.request(
          `${API}/api/public/tenants/client/${clientId}/return?to=${encodeURIComponent(to)}`,
        );
      const confirmed = await returnLink(
        "client-strict",
        "https://app.acme.example/account#security",
      );
      expect(confirmed.status).toBe(200);
      expect(
        z
          .object({
            data: z.object({
              url: z.string(),
              tenant: z.object({ name: z.string() }),
            }),
          })
          .parse(await confirmed.json()).data,
      ).toEqual({
        url: "https://app.acme.example/account#security",
        tenant: expect.objectContaining({ name: "Strict" }),
      });
      expect(
        (await returnLink("client-strict", "http://localhost:3013/account"))
          .status,
      ).toBe(200);
      for (const [clientId, to] of [
        ["client-strict", "https://evil.example/account"],
        ["client-strict", "https://forge.denizlg24.com/"],
        ["client-first-party", "https://forge.denizlg24.com/"],
        ["missing", "https://app.acme.example/"],
      ] as const) {
        expect((await returnLink(clientId, to)).status).toBe(404);
      }
    },
  );
});
