import { afterAll, describe, expect, it } from "bun:test";

import {
  authAccount,
  authTwoFactor,
  authUser,
  authVerification,
  createDb,
  type RateLimitDecision,
  type RateLimitStore,
  users,
} from "@repo/cloud-core";
import {
  completeSignupResultSchema,
  pendingUserCreatedSchema,
  safeUserSchema,
} from "@repo/schemas/cloud";
import { symmetricDecrypt } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";

import { createCloudApiApp } from "../app";
import { createCloudAuth } from "./better-auth";

const integrationUrl = process.env.CLOUD_AUTH_FLOW_TEST_DATABASE_URL;
const integrationTest = integrationUrl ? it : it.skip;
const AUTH_SECRET =
  "integration-better-auth-secret-that-is-at-least-32-characters";
const API_ORIGIN = "https://api.denizlg24.com";
const CLOUD_ORIGIN = "https://cloud.denizlg24.com";

class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();

  async consume(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const hits = (this.hits.get(key) ?? []).filter(
      (timestamp) => now - timestamp < windowMs,
    );
    if (hits.length >= max) {
      return {
        allowed: false,
        retryAfterMs: windowMs - (now - (hits[0] ?? now)),
      };
    }
    hits.push(now);
    this.hits.set(key, hits);
    return { allowed: true, retryAfterMs: 0 };
  }
}

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie) => cookie !== undefined)
    .join("; ");
}

function mergeCookies(...cookieHeaders: string[]): string {
  const cookies = new Map<string, string>();
  for (const header of cookieHeaders) {
    for (const cookie of header.split("; ")) {
      const separator = cookie.indexOf("=");
      if (separator > 0) {
        cookies.set(cookie.slice(0, separator), cookie);
      }
    }
  }
  return [...cookies.values()].join("; ");
}

async function responseData(response: Response): Promise<object> {
  const payload: object = await response.json();
  if (
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null
  ) {
    throw new Error("Expected a response data object");
  }
  return payload.data;
}

let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) {
    await integrationDb.$client.end({ timeout: 5 });
  }
});

describe("Better Auth cloud flow", () => {
  integrationTest(
    "supports legacy Argon2id, pending signup, mandatory TOTP, and cross-origin cookies",
    async () => {
      if (!integrationUrl) {
        throw new Error("CLOUD_AUTH_FLOW_TEST_DATABASE_URL is required");
      }
      const databaseName = new URL(integrationUrl).pathname.slice(1);
      if (!databaseName.endsWith("_auth_test")) {
        throw new Error("Integration database name must end in _auth_test");
      }

      const db = createDb(integrationUrl, { max: 1 });
      integrationDb = db;
      await db.execute(
        sql`TRUNCATE TABLE ${authVerification}, ${authUser}, ${users} CASCADE`,
      );

      const auth = createCloudAuth({
        baseURL: API_ORIGIN,
        cookieDomain: ".denizlg24.com",
        db,
        secret: AUTH_SECRET,
        trustedOrigins: [CLOUD_ORIGIN],
      });
      const app = createCloudApiApp({
        auth,
        db,
        isProduction: true,
        rateLimitStore: new MemoryRateLimitStore(),
        trustedOrigins: [CLOUD_ORIGIN],
      });

      const adminId = crypto.randomUUID();
      const adminPassword = "legacy-password-123";
      const legacyPasswordHash = await Bun.password.hash(adminPassword, {
        algorithm: "argon2id",
        memoryCost: 65_536,
        timeCost: 3,
      });
      const now = new Date();
      await db.insert(authUser).values({
        id: adminId,
        createdAt: now,
        displayUsername: "owner",
        email: "owner@example.com",
        emailVerified: false,
        name: "owner",
        role: "admin",
        status: "active",
        twoFactorEnabled: false,
        updatedAt: now,
        username: "owner",
      });
      await db.insert(authAccount).values({
        id: `credential:${adminId}`,
        accountId: adminId,
        createdAt: now,
        password: legacyPasswordHash,
        providerId: "credential",
        updatedAt: now,
        userId: adminId,
      });
      await db.insert(users).values({
        id: adminId,
        createdAt: now,
        email: "owner@example.com",
        passwordHash: legacyPasswordHash,
        role: "superuser",
        status: "active",
        totpEnabled: true,
        updatedAt: now,
        username: "owner",
      });

      const adminSignIn = await auth.api.signInUsername({
        body: {
          password: adminPassword,
          username: "owner",
        },
        returnHeaders: true,
      });
      const adminCookie = cookieHeader(adminSignIn.headers);
      expect(adminCookie).toContain("deniz-cloud.session_token=");
      await db
        .update(authUser)
        .set({ twoFactorEnabled: true })
        .where(eq(authUser.id, adminId));

      const preflight = await app.request(
        `${API_ORIGIN}/api/auth/admin/create-pending-user`,
        {
          headers: {
            "Access-Control-Request-Headers": "content-type",
            "Access-Control-Request-Method": "POST",
            Origin: CLOUD_ORIGIN,
          },
          method: "OPTIONS",
        },
      );
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
        CLOUD_ORIGIN,
      );
      expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );

      const pendingResponse = await app.request(
        `${API_ORIGIN}/api/auth/admin/create-pending-user`,
        {
          body: JSON.stringify({ role: "user", username: "new-user" }),
          headers: {
            "CF-Connecting-IP": "203.0.113.8",
            "Content-Type": "application/json",
            Cookie: adminCookie,
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        },
      );
      expect(pendingResponse.status).toBe(201);
      const pending = pendingUserCreatedSchema.parse(
        await responseData(pendingResponse),
      );

      await db
        .update(authUser)
        .set({ twoFactorEnabled: false })
        .where(eq(authUser.id, adminId));
      const blockedEnrollmentAdmin = await app.request(
        `${API_ORIGIN}/api/auth/admin/list-users`,
        {
          headers: { Cookie: adminCookie, Origin: CLOUD_ORIGIN },
        },
      );
      expect(blockedEnrollmentAdmin.status).toBe(403);
      expect(await blockedEnrollmentAdmin.json()).toEqual({
        error: {
          code: "MFA_ENROLLMENT_REQUIRED",
          message: "Complete two-factor enrollment before continuing",
        },
      });
      await db
        .update(authUser)
        .set({ twoFactorEnabled: true })
        .where(eq(authUser.id, adminId));

      const removableResponse = await app.request(
        `${API_ORIGIN}/api/auth/admin/create-pending-user`,
        {
          body: JSON.stringify({ role: "user", username: "remove-me" }),
          headers: {
            "Content-Type": "application/json",
            Cookie: adminCookie,
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        },
      );
      expect(removableResponse.status).toBe(201);
      const removable = pendingUserCreatedSchema.parse(
        await responseData(removableResponse),
      );
      const removeResponse = await app.request(
        `${API_ORIGIN}/api/auth/admin/remove-user`,
        {
          body: JSON.stringify({ userId: removable.user.id }),
          headers: {
            "Content-Type": "application/json",
            Cookie: adminCookie,
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        },
      );
      expect(removeResponse.status).toBe(200);
      expect(
        await db.query.authUser.findFirst({
          where: eq(authUser.id, removable.user.id),
        }),
      ).toBeUndefined();
      expect(
        await db.query.users.findFirst({
          where: eq(users.id, removable.user.id),
        }),
      ).toBeUndefined();

      const invalidAttempts = await Promise.all([
        app.request(`${API_ORIGIN}/api/auth/complete-signup`, {
          body: JSON.stringify({
            email: "new-user@example.com",
            password: "new-user-password",
            token: "wrong-token",
            username: "new-user",
          }),
          headers: {
            "CF-Connecting-IP": "203.0.113.9",
            "Content-Type": "application/json",
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        }),
        app.request(`${API_ORIGIN}/api/auth/complete-signup`, {
          body: JSON.stringify({
            email: "missing@example.com",
            password: "new-user-password",
            token: "wrong-token",
            username: "missing-user",
          }),
          headers: {
            "CF-Connecting-IP": "203.0.113.10",
            "Content-Type": "application/json",
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        }),
      ]);
      expect(invalidAttempts.map(({ status }) => status)).toEqual([400, 400]);
      expect(await invalidAttempts[0]?.json()).toEqual(
        await invalidAttempts[1]?.json(),
      );

      const completion = await app.request(
        `${API_ORIGIN}/api/auth/complete-signup`,
        {
          body: JSON.stringify({
            email: "new-user@example.com",
            password: "new-user-password",
            token: pending.signupToken,
            username: "new-user",
          }),
          headers: {
            "CF-Connecting-IP": "203.0.113.11",
            "Content-Type": "application/json",
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        },
      );
      expect(completion.status).toBe(200);
      const completed = completeSignupResultSchema.parse(
        await responseData(completion),
      );
      expect(completed.requiresTotpEnrollment).toBe(true);
      const enrollmentCookie = cookieHeader(completion.headers);
      const setCookie = completion.headers.getSetCookie().join("\n");
      expect(setCookie).toContain("Domain=.denizlg24.com");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Secure");
      expect(completion.headers.get("Access-Control-Allow-Origin")).toBe(
        CLOUD_ORIGIN,
      );
      expect(completion.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );

      const beforeEnrollment = await app.request(`${API_ORIGIN}/api/me`, {
        headers: { Cookie: enrollmentCookie, Origin: CLOUD_ORIGIN },
      });
      expect(beforeEnrollment.status).toBe(403);
      expect(await beforeEnrollment.json()).toEqual({
        error: {
          code: "MFA_ENROLLMENT_REQUIRED",
          message: "Complete two-factor enrollment before continuing",
        },
      });

      const enable = await app.request(
        `${API_ORIGIN}/api/auth/two-factor/enable`,
        {
          body: JSON.stringify({ password: "new-user-password" }),
          headers: {
            "Content-Type": "application/json",
            Cookie: enrollmentCookie,
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        },
      );
      expect(enable.status).toBe(200);
      const enablePayload: object = await enable.json();
      if (
        !("totpURI" in enablePayload) ||
        typeof enablePayload.totpURI !== "string" ||
        !("backupCodes" in enablePayload) ||
        !Array.isArray(enablePayload.backupCodes)
      ) {
        throw new Error("Better Auth TOTP enable response is invalid");
      }
      expect(enablePayload.backupCodes).toHaveLength(10);
      const enrollmentSecret = new URL(enablePayload.totpURI).searchParams.get(
        "secret",
      );
      if (!enrollmentSecret) {
        throw new Error("TOTP enrollment URI did not include a secret");
      }
      const unverifiedTwoFactor = await db.query.authTwoFactor.findFirst({
        where: eq(authTwoFactor.userId, pending.user.id),
      });
      if (!unverifiedTwoFactor) {
        throw new Error("TOTP enrollment was not stored");
      }
      const plaintextSecret = await symmetricDecrypt({
        data: unverifiedTwoFactor.secret,
        key: AUTH_SECRET,
      });
      const generated = await auth.api.generateTOTP({
        body: { secret: plaintextSecret },
      });

      const verify = await app.request(
        `${API_ORIGIN}/api/auth/two-factor/verify-totp`,
        {
          body: JSON.stringify({ code: generated.code }),
          headers: {
            "Content-Type": "application/json",
            Cookie: enrollmentCookie,
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        },
      );
      expect(verify.status).toBe(200);
      const activeCookie = mergeCookies(
        enrollmentCookie,
        cookieHeader(verify.headers),
      );

      const me = await app.request(`${API_ORIGIN}/api/me`, {
        headers: { Cookie: activeCookie, Origin: CLOUD_ORIGIN },
      });
      expect(me.status).toBe(200);
      const safeUser = safeUserSchema.parse(await responseData(me));
      expect(safeUser).toMatchObject({
        email: "new-user@example.com",
        status: "active",
        totpEnabled: true,
        username: "new-user",
      });

      const storedUser = await db.query.users.findFirst({
        where: eq(users.id, pending.user.id),
      });
      const storedAuthUser = await db.query.authUser.findFirst({
        where: eq(authUser.id, pending.user.id),
      });
      const storedTwoFactor = await db.query.authTwoFactor.findFirst({
        where: eq(authTwoFactor.userId, pending.user.id),
      });
      expect(storedUser).toMatchObject({
        status: "active",
        totpEnabled: true,
      });
      expect(storedAuthUser).toMatchObject({
        status: "active",
        twoFactorEnabled: true,
      });
      expect(storedTwoFactor?.verified).toBe(true);

      const passwordReset = await app.request(
        `${API_ORIGIN}/api/auth/admin/set-user-password`,
        {
          body: JSON.stringify({
            newPassword: "new-user-password",
            userId: pending.user.id,
          }),
          headers: {
            "Content-Type": "application/json",
            Cookie: adminCookie,
            Origin: CLOUD_ORIGIN,
          },
          method: "POST",
        },
      );
      expect(passwordReset.status).toBe(200);
      const [resetAccount] = await db
        .select({ password: authAccount.password })
        .from(authAccount)
        .where(eq(authAccount.userId, pending.user.id));
      const resetLegacyUser = await db.query.users.findFirst({
        where: eq(users.id, pending.user.id),
      });
      expect(resetAccount?.password).toBe(resetLegacyUser?.passwordHash);
      expect(
        await Bun.password.verify(
          "new-user-password",
          resetAccount?.password ?? "",
        ),
      ).toBe(true);
    },
    30_000,
  );
});
