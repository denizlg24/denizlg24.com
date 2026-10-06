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
  authOauthResource,
  authTenant,
  authVerification,
} from "@repo/cloud-core/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createCloudApiApp } from "../app";
import { createCloudAuth } from "./better-auth";
import type { AuthEmail, AuthMailer } from "./email";
import type { TurnstileVerifier } from "./turnstile";

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

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .filter((cookie) => !/;\s*max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie) => cookie !== undefined)
    .join("; ");
}

function linkIn(email: AuthEmail | undefined): string {
  const match = /(https?:\/\/\S+)$/m.exec(email?.text ?? "");
  if (!match?.[1]) throw new Error("no link in email");
  return match[1];
}

let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) await integrationDb.$client.end({ timeout: 5 });
});

describe("public deniz accounts", () => {
  integrationTest(
    "sign up for a tenant's app, verify, consent, reset a password",
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

      const outbox: AuthEmail[] = [];
      const mailer: AuthMailer = {
        async send(email) {
          outbox.push(email);
        },
      };
      let human = true;
      const turnstile: TurnstileVerifier = async (token) =>
        human && token === "ok";

      const auth = createCloudAuth({
        baseURL: API,
        cookieDomain: ".denizlg24.com",
        db,
        mailer,
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
        oauth: { issuer: ISSUER, audience: API },
        isProduction: true,
        publicAccounts: {
          mailer,
          turnstile,
          authAppUrl: AUTH_APP,
          apiUrl: API,
        },
        rateLimitStore: new MemoryRateLimitStore(),
        trustedOrigins: [AUTH_APP],
      });
      const request = (path: string, init: RequestInit = {}) =>
        app.request(path.startsWith("http") ? path : `${API}${path}`, init);
      const post = (
        path: string,
        body: unknown,
        headers: Record<string, string> = {},
      ) =>
        request(path, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Origin: AUTH_APP,
            "X-Turnstile-Token": "ok",
            ...headers,
          },
          body: JSON.stringify(body),
        });

      // The owner, a tenant, its API and a web client.
      const ownerId = crypto.randomUUID();
      const now = new Date();
      const hash = await Bun.password.hash("owner-password-123", {
        algorithm: "argon2id",
        memoryCost: 65_536,
        timeCost: 3,
      });
      await db.insert(authUser).values({
        id: ownerId,
        createdAt: now,
        displayUsername: "owner",
        email: "owner@example.com",
        emailVerified: true,
        name: "owner",
        realm: "cloud",
        role: "admin",
        status: "active",
        twoFactorEnabled: false,
        updatedAt: now,
        username: "owner",
      });
      await db.insert(authAccount).values({
        id: `credential:${ownerId}`,
        accountId: ownerId,
        createdAt: now,
        issuer: CREDENTIAL_ACCOUNT_ISSUER,
        password: hash,
        providerId: "credential",
        updatedAt: now,
        userId: ownerId,
      });
      await db.insert(users).values({
        id: ownerId,
        createdAt: now,
        email: "owner@example.com",
        passwordHash: hash,
        role: "superuser",
        status: "active",
        totpEnabled: true,
        updatedAt: now,
        username: "owner",
      });
      const ownerSignIn = await auth.api.signInUsername({
        body: { password: "owner-password-123", username: "owner" },
        returnHeaders: true,
      });
      await db
        .update(authUser)
        .set({ twoFactorEnabled: true })
        .where(eq(authUser.id, ownerId));
      const owner = cookieHeader(ownerSignIn.headers);
      const asOwner = (method: string, path: string, body?: unknown) =>
        request(path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Cookie: owner,
            Origin: AUTH_APP,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

      expect(
        (
          await asOwner("POST", "/api/tenants", {
            slug: "acme",
            name: "Acme",
            signup: "open",
          })
        ).status,
      ).toBe(201);
      await asOwner("POST", "/api/tenants/acme/resources", {
        identifier: ACME_API,
        name: "Acme API",
      });
      const client = z
        .object({ data: z.object({ clientId: z.string() }) })
        .parse(
          await (
            await asOwner("POST", "/api/tenants/acme/clients", {
              kind: "web",
              name: "Acme web",
              redirectUris: [ACME_CALLBACK],
              resources: [ACME_API],
            })
          ).json(),
        ).data;
      const firstParty = z
        .object({ data: z.object({ clientId: z.string() }) })
        .parse(
          await (
            await asOwner("POST", "/api/oauth/clients", {
              kind: "web",
              name: "site",
              redirectUris: [`${WEB}/auth/callback`],
              resources: [WEB],
            })
          ).json(),
        ).data;

      const authorizeUrl = `${ISSUER}/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: ACME_CALLBACK,
        scope: "openid offline_access",
        resource: ACME_API,
        state: "s",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
      })}`;
      const signUp = {
        name: "Carol",
        email: "Carol@Example.com",
        password: "carol-password-1",
        clientId: client.clientId,
        callbackURL: authorizeUrl,
      };

      // --- Guards. -------------------------------------------------------------
      human = false;
      expect((await post("/api/auth/public/sign-up", signUp)).status).toBe(403);
      human = true;
      expect(
        (
          await post("/api/auth/public/sign-up", {
            ...signUp,
            clientId: firstParty.clientId,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post("/api/auth/public/sign-up", {
            ...signUp,
            callbackURL: "https://evil.example/landing",
          })
        ).status,
      ).toBe(400);
      await asOwner("PATCH", "/api/tenants/acme", { signup: "invite" });
      const invite = await post("/api/auth/public/sign-up", signUp);
      expect(invite.status).toBe(403);
      expect(
        z.object({ code: z.string() }).parse(await invite.json()).code,
      ).toBe("SIGNUP_INVITE_ONLY");
      await asOwner("PATCH", "/api/tenants/acme", { signup: "open" });
      expect(outbox).toHaveLength(0);

      // --- Sign up, verify, land back in the authorization. -------------------
      const created = await post("/api/auth/public/sign-up", signUp);
      expect(created.status).toBe(202);
      const carol = await db.query.authUser.findFirst({
        where: eq(authUser.email, "carol@example.com"),
      });
      expect(carol?.realm).toBe("public");
      expect(carol?.emailVerified).toBe(false);
      expect(
        await db.query.users.findFirst({
          where: eq(users.id, carol?.id ?? ""),
        }),
      ).toBeUndefined();
      expect(outbox.at(-1)?.subject).toBe("Confirm your email address");

      // The same address again: same answer, a different email, no second account.
      const again = await post("/api/auth/public/sign-up", signUp);
      expect(again.status).toBe(202);
      expect(await again.json()).toEqual(await created.clone().json());
      expect(outbox.at(-1)?.subject).toBe("You already have a deniz account");
      const verificationLink = linkIn(outbox.at(-2));

      const verified = await request(verificationLink);
      expect(verified.status).toBe(302);
      expect(verified.headers.get("Location")).toBe(authorizeUrl);
      const carolCookie = cookieHeader(verified.headers);
      expect(carolCookie).toContain("session_token");
      expect(
        (
          await db.query.authUser.findFirst({
            where: eq(authUser.id, carol?.id ?? ""),
          })
        )?.emailVerified,
      ).toBe(true);

      const resumed = await request(authorizeUrl, {
        headers: { Cookie: carolCookie },
      });
      expect(resumed.status).toBe(302);
      expect(new URL(resumed.headers.get("Location") ?? "").pathname).toBe(
        "/consent",
      );

      // --- Email sign-in and password reset. ----------------------------------
      const emailSignIn = await post("/api/auth/sign-in/email", {
        email: "carol@example.com",
        password: "carol-password-1",
      });
      expect(emailSignIn.status).toBe(200);

      const sent = outbox.length;
      expect(
        (
          await post("/api/auth/request-password-reset", {
            email: "owner@example.com",
            redirectTo: `${AUTH_APP}/reset-password`,
          })
        ).status,
      ).toBe(200);
      // A cloud account is never reset by email.
      expect(outbox).toHaveLength(sent);

      expect(
        (
          await post("/api/auth/request-password-reset", {
            email: "carol@example.com",
            redirectTo: `${AUTH_APP}/reset-password`,
          })
        ).status,
      ).toBe(200);
      expect(outbox.at(-1)?.subject).toBe("Reset your password");
      const resetLanding = await request(linkIn(outbox.at(-1)));
      expect(resetLanding.status).toBe(302);
      const token =
        new URL(resetLanding.headers.get("Location") ?? "").searchParams.get(
          "token",
        ) ?? "";
      expect(token).not.toBe("");
      expect(
        (
          await post("/api/auth/reset-password", {
            newPassword: "carol-password-2",
            token,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post("/api/auth/sign-in/email", {
            email: "carol@example.com",
            password: "carol-password-2",
          })
        ).status,
      ).toBe(200);

      // A verification link signs in without the second factor, so a cloud
      // account never gets one — even an unverified one, on request.
      await db
        .update(authUser)
        .set({ emailVerified: false })
        .where(eq(authUser.id, ownerId));
      const beforeOwner = outbox.length;
      expect(
        (
          await post("/api/auth/send-verification-email", {
            email: "owner@example.com",
            callbackURL: `${AUTH_APP}/login`,
          })
        ).status,
      ).toBe(200);
      expect(outbox).toHaveLength(beforeOwner);

      // Without a challenge token, nothing that mails anyone answers.
      expect(
        (
          await post(
            "/api/auth/request-password-reset",
            { email: "carol@example.com" },
            { "X-Turnstile-Token": "" },
          )
        ).status,
      ).toBe(403);
    },
    60_000,
  );
});
