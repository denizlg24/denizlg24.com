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
  authSession,
  authTenant,
  authTwoFactor,
  authVerification,
} from "@repo/cloud-core/db/schema";
import { symmetricEncrypt } from "better-auth/crypto";
import { desc, eq, sql } from "drizzle-orm";
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
const STOCKWATCHER = "https://stockwatcher.denizlg24.com";
const EVIL = "https://evil.example";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

class MemoryRateLimitStore implements PeekableRateLimitStore {
  async consume(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
  async peek(): Promise<RateLimitDecision> {
    return { allowed: true, retryAfterMs: 0 };
  }
}

/** A browser's cookies for one site: later Set-Cookie wins, max-age=0 deletes. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(headers: Headers): this {
    for (const cookie of headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator);
      if (/;\s*max-age=0(;|$)/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, pair);
    }
    return this;
  }

  has(fragment: string): boolean {
    return [...this.cookies.keys()].some((name) => name.includes(fragment));
  }

  drop(fragment: string): void {
    for (const name of [...this.cookies.keys()]) {
      if (name.includes(fragment)) this.cookies.delete(name);
    }
  }

  header(): string {
    return [...this.cookies.values()].join("; ");
  }
}

function linkIn(email: AuthEmail | undefined): string {
  const match = /(https?:\/\/\S+)$/m.exec(email?.text ?? "");
  if (!match?.[1]) throw new Error("no link in email");
  return match[1];
}

function landing(response: Response): URL {
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (!location) throw new Error("no redirect");
  return new URL(location);
}

let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) await integrationDb.$client.end({ timeout: 5 });
});

describe("sign-in links", () => {
  integrationTest(
    "issue, verify, challenge the second factor, refuse what must be refused",
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
      const turnstile: TurnstileVerifier = async (token) => token === "ok";
      const oauth = {
        authAppUrl: AUTH_APP,
        resources: {
          api: API,
          web: WEB,
          mcp: "https://mcp.denizlg24.com/mcp",
          status: "https://status.denizlg24.com",
          macros: "https://macros.denizlg24.com",
        },
      };
      const auth = createCloudAuth({
        baseURL: API,
        cookieDomain: ".denizlg24.com",
        db,
        mailer,
        secret: AUTH_SECRET,
        trustedOrigins: [AUTH_APP],
        oauth,
      });
      const app = createCloudApiApp({
        auth,
        db,
        oauth: { issuer: ISSUER, audience: API, authAppUrl: AUTH_APP },
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
      const get = (url: string, jar?: CookieJar) =>
        app.request(url, {
          headers: jar ? { Cookie: jar.header() } : {},
        });
      const post = (
        path: string,
        body: unknown,
        headers: Record<string, string> = {},
      ) =>
        app.request(`${API}${path}`, {
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

      const now = new Date();
      const passwordHash = await Bun.password.hash("a-password-123", {
        algorithm: "argon2id",
        memoryCost: 65_536,
        timeCost: 3,
      });
      const createAccount = async (input: {
        username: string;
        realm: "cloud" | "public";
        superuser?: boolean;
        emailVerified?: boolean;
        twoFactor?: boolean;
      }) => {
        const id = crypto.randomUUID();
        const email = `${input.username}@example.com`;
        await db.insert(authUser).values({
          id,
          createdAt: now,
          displayUsername: input.username,
          email,
          emailVerified: input.emailVerified ?? true,
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
          password: passwordHash,
          providerId: "credential",
          updatedAt: now,
          userId: id,
        });
        if (input.realm === "cloud") {
          await db.insert(users).values({
            id,
            createdAt: now,
            email,
            passwordHash,
            role: input.superuser ? "superuser" : "user",
            status: "active",
            totpEnabled: input.twoFactor === true,
            updatedAt: now,
            username: input.username,
          });
        }
        if (input.twoFactor) {
          await db.insert(authTwoFactor).values({
            id: crypto.randomUUID(),
            secret: await symmetricEncrypt({
              key: AUTH_SECRET,
              data: TOTP_SECRET,
            }),
            backupCodes: await symmetricEncrypt({
              key: AUTH_SECRET,
              data: JSON.stringify(["backup-1"]),
            }),
            userId: id,
            verified: true,
          });
          await db
            .update(authUser)
            .set({ twoFactorEnabled: true })
            .where(eq(authUser.id, id));
        }
        return { id, email };
      };
      const totp = async () =>
        (await auth.api.generateTOTP({ body: { secret: TOTP_SECRET } })).code;

      // The owner signs in before enrolling, which is the only way past TOTP
      // without a code here; the cookie is all the admin routes need.
      const owner = await createAccount({
        username: "owner",
        realm: "cloud",
        superuser: true,
      });
      const ownerSignIn = await auth.api.signInUsername({
        body: { password: "a-password-123", username: "owner" },
        returnHeaders: true,
      });
      await db
        .update(authUser)
        .set({ twoFactorEnabled: true })
        .where(eq(authUser.id, owner.id));
      const ownerJar = new CookieJar().absorb(ownerSignIn.headers);
      const asOwner = (path: string, body?: unknown) =>
        app.request(`${API}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: ownerJar.header(),
            Origin: AUTH_APP,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

      const mum = await createAccount({
        username: "mum",
        realm: "cloud",
        twoFactor: true,
      });
      const dad = await createAccount({
        username: "dad",
        realm: "cloud",
        twoFactor: true,
        emailVerified: false,
      });
      const pat = await createAccount({ username: "pat", realm: "public" });

      // Stockwatcher is the owner's client; the dynamic one is anyone's.
      expect(
        (
          await asOwner("/api/oauth/clients", {
            kind: "web",
            name: "Stockwatcher",
            redirectUris: [`${STOCKWATCHER}/auth/callback`],
            resources: [WEB],
          })
        ).status,
      ).toBe(201);
      await db.insert(authOauthClient).values({
        id: crypto.randomUUID(),
        clientId: "dynamic-evil",
        redirectUris: [`${EVIL}/callback`],
        createdAt: now,
        updatedAt: now,
      });

      const destinations = z
        .object({
          data: z.array(z.object({ origin: z.string(), name: z.string() })),
        })
        .parse(
          await (
            await asOwner("/api/auth/admin/sign-in-link-destinations")
          ).json(),
        ).data;
      expect(destinations).toContainEqual({
        origin: STOCKWATCHER,
        name: "Stockwatcher",
      });
      expect(destinations.some((d) => d.origin === EVIL)).toBe(false);

      const callback = (returnTo?: string, error = false) => {
        const url = new URL("/login", AUTH_APP);
        if (returnTo) url.searchParams.set("returnTo", returnTo);
        if (error) url.searchParams.set("signInLink", "error");
        return url.toString();
      };
      const requestLink = (email: string, returnTo = `${STOCKWATCHER}/`) =>
        post("/api/auth/sign-in/magic-link", {
          email,
          callbackURL: callback(returnTo),
          errorCallbackURL: callback(returnTo, true),
        });

      // The callback and its destination are held to the allow-list.
      expect((await requestLink(mum.email, `${EVIL}/`)).status).toBe(400);
      expect(
        (
          await post("/api/auth/sign-in/magic-link", {
            email: mum.email,
            callbackURL: `${EVIL}/`,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post("/api/auth/sign-in/magic-link", {
            email: mum.email,
            callbackURL: callback(`${STOCKWATCHER}/`),
            newUserCallbackURL: callback(),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(
            "/api/auth/sign-in/magic-link",
            { email: mum.email, callbackURL: callback() },
            { "X-Turnstile-Token": "bot" },
          )
        ).status,
      ).toBe(403);

      // Same answer for every address; mail only for the eligible one.
      for (const email of [
        "nobody@example.com",
        dad.email,
        mum.email.toUpperCase(),
      ]) {
        const response = await requestLink(email);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: true });
      }
      expect(outbox.map((email) => email.to)).toEqual([mum.email]);
      expect(outbox[0]?.subject).toBe("Your sign-in link");
      const mumLink = linkIn(outbox[0]);
      expect(new URL(mumLink).searchParams.get("callbackURL")).toBe(
        callback(`${STOCKWATCHER}/`),
      );
      // Hashed at rest: the token in the link is not what the row holds.
      const token = new URL(mumLink).searchParams.get("token") ?? "";
      expect(
        await db.query.authVerification.findFirst({
          where: eq(authVerification.identifier, `magic-link:${token}`),
        }),
      ).toBeUndefined();

      // A hand-edited destination is refused before the token is spent.
      const edited = new URL(mumLink);
      edited.searchParams.set("callbackURL", callback(`${EVIL}/`));
      const editedLanding = landing(await get(edited.toString()));
      expect(editedLanding.origin).toBe(AUTH_APP);
      expect(editedLanding.searchParams.get("error")).toBe("INVALID_LINK");
      expect(editedLanding.searchParams.has("returnTo")).toBe(false);

      // Mum has a second factor, so the link alone is not a session.
      const mumJar = new CookieJar();
      const challenged = await get(mumLink, mumJar);
      mumJar.absorb(challenged.headers);
      const challengeLanding = landing(challenged);
      expect(challengeLanding.origin).toBe(AUTH_APP);
      expect(challengeLanding.pathname).toBe("/login");
      expect(challengeLanding.searchParams.get("returnTo")).toBe(
        `${STOCKWATCHER}/`,
      );
      expect(challengeLanding.searchParams.get("signInLink")).toBe("challenge");
      expect(mumJar.has("session_token")).toBe(false);
      expect(mumJar.has("two_factor")).toBe(true);
      expect(
        await db
          .select({ id: authSession.id })
          .from(authSession)
          .where(eq(authSession.userId, mum.id)),
      ).toHaveLength(0);

      // Single use.
      const reused = landing(await get(mumLink));
      expect(reused.searchParams.get("signInLink")).toBe("error");
      expect(reused.searchParams.get("error")).toBe("INVALID_TOKEN");
      expect(reused.searchParams.get("returnTo")).toBe(`${STOCKWATCHER}/`);

      // The plugin's own TOTP route finishes it, never remembered.
      const verified = await post(
        "/api/auth/two-factor/verify-totp",
        { code: await totp(), trustDevice: true },
        { Cookie: mumJar.header() },
      );
      expect(verified.status).toBe(200);
      mumJar.absorb(verified.headers);
      expect(mumJar.has("session_token")).toBe(true);
      expect(mumJar.has("trust_device")).toBe(true);
      const [mumSession] = await db
        .select({ rememberMe: authSession.rememberMe })
        .from(authSession)
        .where(eq(authSession.userId, mum.id))
        .orderBy(desc(authSession.createdAt))
        .limit(1);
      expect(mumSession?.rememberMe).toBe(false);

      // On a device it trusts, the link signs straight in, as a password would.
      mumJar.drop("session_token");
      mumJar.drop("session_data");
      outbox.length = 0;
      expect((await requestLink(mum.email)).status).toBe(200);
      const trusted = await get(linkIn(outbox[0]), mumJar);
      mumJar.absorb(trusted.headers);
      const trustedLanding = landing(trusted);
      expect(trustedLanding.toString()).toBe(callback(`${STOCKWATCHER}/`));
      expect(mumJar.has("session_token")).toBe(true);

      // A public account without a second factor signs straight in.
      outbox.length = 0;
      expect((await requestLink(pat.email, `${AUTH_APP}/account`)).status).toBe(
        200,
      );
      const patJar = new CookieJar();
      const patSignedIn = await get(linkIn(outbox[0]), patJar);
      patJar.absorb(patSignedIn.headers);
      expect(landing(patSignedIn).searchParams.get("returnTo")).toBe(
        `${AUTH_APP}/account`,
      );
      expect(patJar.has("session_token")).toBe(true);

      // An account banned after the link went out gets no session.
      outbox.length = 0;
      expect((await requestLink(mum.email)).status).toBe(200);
      const beforeBan = linkIn(outbox[0]);
      await db
        .update(authUser)
        .set({ banned: true })
        .where(eq(authUser.id, mum.id));
      const bannedJar = new CookieJar();
      const banned = await get(beforeBan, bannedJar);
      bannedJar.absorb(banned.headers);
      expect(landing(banned).searchParams.get("signInLink")).toBe("error");
      expect(bannedJar.has("session_token")).toBe(false);
      expect(bannedJar.has("two_factor")).toBe(false);
      await db
        .update(authUser)
        .set({ banned: false })
        .where(eq(authUser.id, mum.id));

      // So does one whose second factor was reset in between: the session the
      // plugin made is taken back.
      outbox.length = 0;
      expect((await requestLink(mum.email)).status).toBe(200);
      const beforeReset = linkIn(outbox[0]);
      await db
        .update(authUser)
        .set({ twoFactorEnabled: false })
        .where(eq(authUser.id, mum.id));
      const resetJar = new CookieJar();
      const reset = await get(beforeReset, resetJar);
      resetJar.absorb(reset.headers);
      expect(landing(reset).searchParams.get("error")).toBe(
        "ACCOUNT_UNAVAILABLE",
      );
      expect(resetJar.has("session_token")).toBe(false);
      await db
        .update(authUser)
        .set({ twoFactorEnabled: true })
        .where(eq(authUser.id, mum.id));

      // An address unconfirmed by the time the link is opened keeps its
      // credentials: the plugin would otherwise delete them.
      outbox.length = 0;
      expect((await requestLink(pat.email)).status).toBe(200);
      const beforeUnverify = linkIn(outbox[0]);
      await db
        .update(authUser)
        .set({ emailVerified: false })
        .where(eq(authUser.id, pat.id));
      const unverified = landing(await get(beforeUnverify));
      expect(unverified.searchParams.get("signInLink")).toBe("error");
      expect(
        await db.query.authAccount.findFirst({
          where: eq(authAccount.userId, pat.id),
        }),
      ).toBeDefined();
      expect(
        (
          await db.query.authUser.findFirst({
            columns: { emailVerified: true },
            where: eq(authUser.id, pat.id),
          })
        )?.emailVerified,
      ).toBe(false);

      // The owner's issuance: mailed, copied, refused, confirmed.
      outbox.length = 0;
      const mailed = await asOwner("/api/auth/admin/send-sign-in-link", {
        userId: mum.id,
        returnTo: `${STOCKWATCHER}/`,
      });
      expect(mailed.status).toBe(201);
      const mailedBody = z
        .object({
          data: z.object({
            delivery: z.literal("email"),
            email: z.string(),
            expiresAt: z.string(),
            url: z.string().optional(),
          }),
        })
        .parse(await mailed.json()).data;
      expect(mailedBody.email).toBe(mum.email);
      expect(mailedBody.url).toBeUndefined();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.text).toContain("no password needed");
      expect(new URL(linkIn(outbox[0])).searchParams.get("callbackURL")).toBe(
        callback(`${STOCKWATCHER}/`),
      );

      outbox.length = 0;
      const copied = await asOwner("/api/auth/admin/send-sign-in-link", {
        userId: mum.id,
        delivery: "copy",
      });
      expect(copied.status).toBe(201);
      const copiedUrl = z
        .object({ data: z.object({ url: z.string() }) })
        .parse(await copied.json()).data.url;
      expect(copiedUrl.startsWith(`${ISSUER}/magic-link/verify?`)).toBe(true);
      expect(outbox).toHaveLength(0);
      expect(landing(await get(copiedUrl)).searchParams.get("signInLink")).toBe(
        "challenge",
      );

      expect(
        (
          await asOwner("/api/auth/admin/send-sign-in-link", {
            userId: mum.id,
            returnTo: `${EVIL}/`,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await asOwner("/api/auth/admin/send-sign-in-link", {
            userId: pat.id,
          })
        ).status,
      ).toBe(404);

      const refused = await asOwner("/api/auth/admin/send-sign-in-link", {
        userId: dad.id,
      });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        code: "EMAIL_NOT_VERIFIED",
      });
      outbox.length = 0;
      expect(
        (
          await asOwner("/api/auth/admin/send-sign-in-link", {
            userId: dad.id,
            confirmEmail: true,
          })
        ).status,
      ).toBe(201);
      expect(outbox.map((email) => email.to)).toEqual([dad.email]);
      expect(
        landing(await get(linkIn(outbox[0]))).searchParams.get("signInLink"),
      ).toBe("challenge");
      expect(
        await db.query.authAccount.findFirst({
          where: eq(authAccount.userId, dad.id),
        }),
      ).toBeDefined();

      // Nobody else can issue one.
      const anonymous = await app.request(
        `${API}/api/auth/admin/send-sign-in-link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: AUTH_APP },
          body: JSON.stringify({ userId: mum.id }),
        },
      );
      expect(anonymous.status).toBe(401);
    },
    60_000,
  );
});
