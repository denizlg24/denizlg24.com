import { createHmac } from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  oauthDeviceAuthorization,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { type Database, hashPassword, verifyPassword } from "@repo/cloud-core";
import * as schema from "@repo/cloud-core/db/schema";
import {
  AUTH_APP_URL,
  MIN_PASSWORD_LENGTH,
  OAUTH_RESOURCES,
  OAUTH_SERVICE_SCOPE,
  OAUTH_SUPERUSER_CLAIM,
  OAUTH_SUPERUSER_SCOPE,
  OAUTH_TENANT_CLAIM,
  type OAuthResourceKey,
} from "@repo/schemas/cloud";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import {
  admin,
  jwt,
  magicLink,
  twoFactor,
  username,
} from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type AuthMailer,
  passwordResetEmail,
  signInLinkEmail,
  unavailableMailer,
  verificationEmail,
} from "./email";
import {
  assertUserVerified,
  type PasskeyRelyingParty,
  passkeyRelyingParty,
} from "./passkey";
import { rememberMeGrants } from "./remember-me";
import {
  currentOwnerIssuance,
  SIGN_IN_LINK_EXPIRES_IN_SECONDS,
  type SignInLinkLanding,
  signInLinkLandingUrl,
  signInLinkRefusal,
} from "./sign-in-link";
import {
  activeTenant,
  currentTenantClientGrant,
  tenantAccess,
  tenantOfClientMetadata,
} from "./tenancy";

const SESSION_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;
const MACHINE_ACCESS_TOKEN_SECONDS = 5 * 60;
const WEB_ACCESS_TOKEN_SECONDS = 15 * 60;
// A trusted device skips the TOTP step. The plugin re-issues the trust on
// every sign-in from that device, so this is how long a device may go unused
// before it is challenged again, not how often it is.
const TRUST_DEVICE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
// A browser that loads an admin page fires several requests at once, and each
// one finds the same expired access token. Without a grace window the second
// refresh is indistinguishable from a stolen token being replayed, and the
// whole grant is revoked.
const REFRESH_REUSE_GRACE_SECONDS = 30;
// Long enough to find a phone and sign in on it; the TV asks for a new code
// after that.
const DEVICE_CODE_EXPIRES_IN = "15m";
// The plugin's default; how long a challenged sign-in has to enter its code.
const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 10 * 60;
// Better Auth's own per-endpoint limiter, on top of the API's per-IP one.
const SIGN_IN_LINK_RATE_LIMIT = { window: 60, max: 5 };
const SIGN_IN_LINK_VERIFY_PATH = "/magic-link/verify";

// Dev ports, one per app: 3000 web, 3001 api, 3002 cloud, 3005 storage,
// 3006 forge, 3007 status, 3008 auth.
// (3003 is the terminal service, 3004 the desktop shell's Next server —
// neither talks to better-auth from a browser origin.)
export const CLOUD_AUTH_TRUSTED_ORIGINS = [
  "https://auth.denizlg24.com",
  "https://cloud.denizlg24.com",
  "https://forge.denizlg24.com",
  // The Forge dashboard has to authenticate on its generated hostname before
  // it can take over forge.denizlg24.com. Scope the wildcard to this one
  // project; trusting every deployment hostname would let unrelated preview
  // code make credentialed requests to the cloud API.
  "https://forge-server-*.denizlg24.com",
  "https://storage.denizlg24.com",
  "https://status.denizlg24.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3005",
  "http://localhost:3006",
  "http://localhost:3007",
  "http://localhost:3008",
] as const;

const FORGE_DEPLOYMENT_ORIGIN =
  /^https:\/\/forge-server-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.denizlg24\.com$/;
const FORGE_DEPLOYMENT_ORIGIN_PATTERN = "https://forge-server-*.denizlg24.com";

/** Mirror Better Auth's one intentional wildcard for the API CORS layer. */
export function isCloudAuthTrustedOrigin(
  origin: string,
  trustedOrigins: readonly string[] = CLOUD_AUTH_TRUSTED_ORIGINS,
): boolean {
  if (
    trustedOrigins.some(
      (trusted) => !trusted.includes("*") && trusted === origin,
    )
  ) {
    return true;
  }
  return (
    trustedOrigins.includes(FORGE_DEPLOYMENT_ORIGIN_PATTERN) &&
    FORGE_DEPLOYMENT_ORIGIN.test(origin)
  );
}

export interface CloudOAuthConfig {
  /** Hosts the login and consent pages the authorization server redirects to. */
  authAppUrl: string;
  resources: Record<OAuthResourceKey, string>;
}

export const DEFAULT_CLOUD_OAUTH_CONFIG: CloudOAuthConfig = {
  authAppUrl: AUTH_APP_URL,
  resources: { ...OAUTH_RESOURCES },
};

export interface CloudAuthOptions {
  db: Database;
  baseURL: string;
  secret: string;
  cookieDomain?: string;
  trustedOrigins?: readonly string[];
  oauth?: CloudOAuthConfig;
  /** Derived from `cookieDomain` and the auth app URL when omitted. */
  passkey?: Partial<PasskeyRelyingParty>;
  /** Verification and password-reset mail. Omitted, every send fails. */
  mailer?: AuthMailer;
  /** Sign-ins and credential changes on cloud accounts, for the owner's phone. */
  onSecurityEvent?: (event: SecurityEvent) => void;
}

export interface SecurityEvent {
  type: "auth_sign_in" | "auth_credential_changed";
  subjectKey: string;
  title: string;
  message: string;
}

/** "Safari on iPhone"-ish, from a user agent, for a one-line headline. */
export function describeUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  if (browser && device) return `${browser} on ${device}`;
  return browser ?? device ?? "Unknown device";
}

const uuidSchema = z.uuid();

/**
 * Mail goes only to accounts that may receive it, so awaiting it would let
 * response time and delivery failures reveal which addresses hold one.
 */
function deliverInBackground(delivery: Promise<void>, kind: string): void {
  delivery.catch((error: unknown) => {
    console.error(`${kind} mail failed`, error);
  });
}

/**
 * The one test every OAuth grant is held to, at issuance and again at every
 * refresh: the role lives on the legacy users row, enrollment and bans on the
 * auth row, and a grant must not outlive any of them changing.
 */
export async function isActiveSuperuser(
  db: Database,
  userId: string,
): Promise<boolean> {
  // The legacy id column is a uuid; anything else reaches Postgres as a cast
  // error instead of a miss.
  if (!uuidSchema.safeParse(userId).success) return false;
  const [legacy, account] = await Promise.all([
    db.query.users.findFirst({
      columns: { role: true },
      where: eq(schema.users.id, userId),
    }),
    db.query.authUser.findFirst({
      columns: {
        banned: true,
        realm: true,
        status: true,
        twoFactorEnabled: true,
      },
      where: eq(schema.authUser.id, userId),
    }),
  ]);
  return (
    legacy?.role === "superuser" &&
    account?.realm === "cloud" &&
    account.status === "active" &&
    account.twoFactorEnabled === true &&
    account.banned !== true
  );
}

function denied(description: string): APIError {
  return new APIError("FORBIDDEN", {
    error: "access_denied",
    error_description: description,
  });
}

type AuthHookContext = Parameters<
  Parameters<typeof createAuthMiddleware>[0]
>[0];

/** The twoFactor plugin's cookie and HMAC formats, which its routes read back. */
const TWO_FACTOR_COOKIE = "two_factor";
const TRUST_DEVICE_COOKIE = "trust_device";

function trustDeviceToken(secret: string, userId: string, identifier: string) {
  return createHmac("sha256", secret)
    .update(`${userId}!${identifier}`)
    .digest("base64url");
}

export function cloudAuthIssuer(baseURL: string): string {
  return `${baseURL.replace(/\/$/, "")}/api/auth`;
}

export function createCloudAuth(options: CloudAuthOptions) {
  const oauth = options.oauth ?? DEFAULT_CLOUD_OAUTH_CONFIG;
  const mailer = options.mailer ?? unavailableMailer();
  const authAppUrl = oauth.authAppUrl.replace(/\/$/, "");
  const rememberMe = rememberMeGrants({
    db: options.db,
    secret: options.secret,
  });
  const relyingParty = {
    ...passkeyRelyingParty({
      authAppUrl,
      cookieDomain: options.cookieDomain,
      rpId: options.passkey?.rpId,
    }),
    ...(options.passkey?.origins ? { origins: options.passkey.origins } : {}),
  };

  /**
   * Runs after `/magic-link/verify`. A link proves the mailbox and nothing
   * more, so it is held to exactly what a password is: an account that has
   * since become ineligible gets no session, and one with a second factor is
   * challenged for it — unless this browser is a device it trusts, as on the
   * password path — using the twoFactor plugin's own cookie and rows, so its
   * `/two-factor/verify-*` routes finish the sign-in. The browser lands on
   * the auth app's `/login`, which asks for the code and then resumes.
   */
  const settleSignInLink = async (ctx: AuthHookContext): Promise<void> => {
    const callbackURL =
      typeof ctx.query?.callbackURL === "string"
        ? ctx.query.callbackURL
        : undefined;
    const land = (landing: SignInLinkLanding, error?: string) => {
      const target = new URL(
        signInLinkLandingUrl(authAppUrl, callbackURL, landing),
      );
      if (error) target.searchParams.set("error", error);
      return ctx.redirect(target.toString());
    };
    // No session: the plugin already redirected to the error callback, or a
    // hook refused it (a ban, the credential guard), which `app.ts` turns
    // into the same landing — an after hook cannot change a failed status.
    const issued = ctx.context.newSession;
    if (!issued) return;
    const userId = issued.user.id;
    const secret = ctx.context.secret;
    const adapter = ctx.context.internalAdapter;
    const discardSession = async () => {
      deleteSessionCookie(ctx, true);
      await adapter.deleteSession(issued.session.token);
      ctx.context.setNewSession(null);
    };
    const account = await options.db.query.authUser.findFirst({
      columns: {
        banned: true,
        emailVerified: true,
        realm: true,
        status: true,
        twoFactorEnabled: true,
      },
      where: eq(schema.authUser.id, userId),
    });
    if (signInLinkRefusal(account) !== null) {
      await discardSession();
      throw land("error", "ACCOUNT_UNAVAILABLE");
    }
    if (account?.twoFactorEnabled !== true) return;

    const trustCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE, {
      maxAge: TRUST_DEVICE_MAX_AGE_SECONDS,
    });
    const trust = await ctx.getSignedCookie(trustCookie.name, secret);
    const [trustToken, trustIdentifier] = trust ? trust.split("!") : [];
    if (
      trustToken &&
      trustIdentifier &&
      trustToken === trustDeviceToken(secret, userId, trustIdentifier)
    ) {
      const record = await adapter.findVerificationValue(trustIdentifier);
      if (
        record &&
        record.value === userId &&
        record.expiresAt.getTime() > Date.now()
      ) {
        // Re-issued on every sign-in, as the plugin does on the password path.
        await adapter.deleteVerificationByIdentifier(trustIdentifier);
        const renewed = `trust-device-${generateRandomString(32)}`;
        await adapter.createVerificationValue({
          value: userId,
          identifier: renewed,
          expiresAt: new Date(Date.now() + TRUST_DEVICE_MAX_AGE_SECONDS * 1000),
        });
        await ctx.setSignedCookie(
          trustCookie.name,
          `${trustDeviceToken(secret, userId, renewed)}!${renewed}`,
          secret,
          trustCookie.attributes,
        );
        return;
      }
    }
    if (trust) expireCookie(ctx, trustCookie);

    await discardSession();
    const challengeCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE, {
      maxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS,
    });
    const identifier = `2fa-${generateRandomString(20)}`;
    const expiresAt = new Date(
      Date.now() + TWO_FACTOR_COOKIE_MAX_AGE_SECONDS * 1000,
    );
    await adapter.createVerificationValue({
      value: userId,
      identifier,
      expiresAt,
    });
    await adapter.createVerificationValue({
      value: "0",
      identifier: `2fa-attempts-${identifier}`,
      expiresAt,
    });
    await ctx.setSignedCookie(
      challengeCookie.name,
      identifier,
      secret,
      challengeCookie.attributes,
    );
    const dontRemember = ctx.context.authCookies.dontRememberToken;
    await ctx.setSignedCookie(
      dontRemember.name,
      "true",
      secret,
      dontRemember.attributes,
    );
    throw land("challenge");
  };

  return betterAuth({
    appName: "Deniz Cloud",
    baseURL: options.baseURL,
    secret: options.secret,
    // The JWT plugin's own /token mints a session JWT for whoever holds the
    // cookie. Every JWT here comes from /oauth2/token instead, bound to a
    // resource and to the superuser gate.
    disabledPaths: ["/token"],
    account: {
      modelName: "authAccount",
    },
    advanced: {
      cookiePrefix: "deniz-cloud",
      crossSubDomainCookies: {
        domain: options.cookieDomain,
        enabled: options.cookieDomain !== undefined,
      },
      database: {
        generateId: () => crypto.randomUUID(),
      },
      useSecureCookies: new URL(options.baseURL).protocol === "https:",
    },
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: {
        ...schema,
        account: schema.authAccount,
        session: schema.authSession,
        user: schema.authUser,
        verification: schema.authVerification,
      },
    }),
    hooks: {
      // Better Auth records `rememberMe: false` as a `dont_remember` cookie
      // that the TOTP step reads back, but never clears it on a later sign-in
      // that does want remembering. Without this, one unchecked sign-in makes
      // every following one in that browser unchecked too.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/username") return;
        if (ctx.body?.rememberMe === false) return;
        expireCookie(ctx, ctx.context.authCookies.dontRememberToken);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === SIGN_IN_LINK_VERIFY_PATH) {
          await settleSignInLink(ctx);
          return;
        }
        // A passkey is both factors, so adding one is worth knowing about.
        if (ctx.path !== "/passkey/verify-registration") return;
        const report = options.onSecurityEvent;
        const user = ctx.context.session?.user;
        if (!report || !user || ctx.context.returned instanceof Error) return;
        report({
          type: "auth_credential_changed",
          subjectKey: `passkey:${user.id}:${Date.now()}`,
          title: "Passkey added",
          message: user.name,
        });
      }),
    },
    databaseHooks: {
      account: {
        delete: {
          // Verifying a link for an account whose address was never confirmed
          // makes the plugin delete every credential on it. Issuance refuses
          // such accounts; this stops one that changed in between.
          before: async (_account, context) => {
            if (context?.path === SIGN_IN_LINK_VERIFY_PATH) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_UNAVAILABLE",
                message: "This account can't use sign-in links",
              });
            }
          },
        },
      },
      session: {
        create: {
          // Mirrors how Better Auth itself decides: a sign-in answers from its
          // body, while the TOTP step — which creates the session that
          // survives — only knows the answer through the `dont_remember`
          // cookie the sign-in left behind. A sign-in link is never
          // remembered — an emailed credential does not get to mint the
          // non-expiring refresh handle — and its second-factor step reads the
          // `dont_remember` cookie `settleSignInLink` leaves.
          before: async (session, context) => {
            if (!context) return;
            const rememberMe =
              context.path === SIGN_IN_LINK_VERIFY_PATH
                ? false
                : context.path.startsWith("/sign-in/")
                  ? context.body?.rememberMe !== false
                  : !(await context.getSignedCookie(
                      context.context.authCookies.dontRememberToken.name,
                      context.context.secret,
                    ));
            return { data: { ...session, rememberMe } };
          },
          after: async (session, context) => {
            const report = options.onSecurityEvent;
            if (!report) return;
            const account = await options.db.query.authUser.findFirst({
              columns: { name: true, realm: true },
              where: eq(schema.authUser.id, session.userId),
            });
            if (account?.realm !== "cloud") return;
            report({
              type: "auth_sign_in",
              subjectKey: session.id,
              title: `New sign-in · ${account.name}`,
              message: [
                describeUserAgent(session.userAgent),
                session.ipAddress,
                context?.path === SIGN_IN_LINK_VERIFY_PATH
                  ? "sign-in link"
                  : null,
              ]
                .filter(Boolean)
                .join(" · "),
            });
          },
        },
      },
      user: {
        update: {
          after: async (authUser) => {
            const role =
              "role" in authUser && authUser.role === "admin"
                ? "superuser"
                : "user";
            const twoFactorEnabled =
              "twoFactorEnabled" in authUser &&
              authUser.twoFactorEnabled === true;
            const status =
              "status" in authUser && authUser.status === "pending"
                ? "pending"
                : "active";
            const activatedStatus = twoFactorEnabled ? "active" : status;
            const legacyUsername =
              "username" in authUser && typeof authUser.username === "string"
                ? authUser.username
                : authUser.name;

            await options.db.transaction(async (tx) => {
              if (twoFactorEnabled) {
                await tx
                  .update(schema.authUser)
                  .set({ status: "active" })
                  .where(eq(schema.authUser.id, authUser.id));
              }
              await tx
                .update(schema.users)
                .set({
                  email: authUser.email,
                  role,
                  status: activatedStatus,
                  updatedAt: authUser.updatedAt,
                  username: legacyUsername,
                  ...(twoFactorEnabled ? { totpEnabled: true } : {}),
                })
                .where(eq(schema.users.id, authUser.id));
            });
          },
        },
      },
    },
    emailAndPassword: {
      autoSignIn: false,
      // Public accounts are made by `/api/auth/public/sign-up`, which applies
      // the tenant's policy and Turnstile first; the plugin's own route stays shut.
      disableSignUp: true,
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // A cloud account's credentials are the owner's to manage; an email
      // address must never be a way into storage or the superuser's account.
      // Better Auth answers the request identically either way.
      sendResetPassword: async ({ user, url }) => {
        const account = await options.db.query.authUser.findFirst({
          columns: { realm: true },
          where: eq(schema.authUser.id, user.id),
        });
        if (account?.realm !== "public") return;
        deliverInBackground(
          mailer.send(
            passwordResetEmail({ to: user.email, name: user.name, url }),
          ),
          "Password reset",
        );
      },
    },
    emailVerification: {
      // Opening the link signs in, which is what lets a new account resume
      // the authorization it signed up from. A sign-in that is one email
      // away must never reach an account with a second factor: that would
      // skip it, and for a cloud superuser it would skip the whole cloud's.
      // So the link is only ever sent to a public account without one.
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        const account = await options.db.query.authUser.findFirst({
          columns: { realm: true, twoFactorEnabled: true },
          where: eq(schema.authUser.id, user.id),
        });
        if (account?.realm !== "public" || account.twoFactorEnabled === true) {
          return;
        }
        deliverInBackground(
          mailer.send(
            verificationEmail({ to: user.email, name: user.name, url }),
          ),
          "Verification",
        );
      },
    },
    plugins: [
      admin(),
      twoFactor({
        issuer: "Deniz Cloud",
        totpOptions: {
          digits: 6,
          period: 30,
        },
        trustDeviceMaxAge: TRUST_DEVICE_MAX_AGE_SECONDS,
        twoFactorCookieMaxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS,
        twoFactorTable: "authTwoFactor",
      }),
      // A passkey sign-in is not a `/sign-in/*` path, so the twoFactor hook
      // never challenges it: the credential is both factors. That is why
      // registration insists on a resident, user-verified credential and
      // authentication refuses one that was not verified.
      passkey({
        rpID: relyingParty.rpId,
        rpName: "Deniz Cloud",
        origin: relyingParty.origins,
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        authentication: {
          afterVerification: ({ verification }) =>
            assertUserVerified(verification.authenticationInfo.userVerified),
        },
        schema: { passkey: { modelName: "authPasskey" } },
      }),
      // One-time sign-in links, for existing accounts only. The plugin signs
      // in on `/magic-link/verify`, which the twoFactor hook does not match;
      // `settleSignInLink` holds it to the second factor (and to the account
      // still being eligible) instead. Tokens are hashed at rest, consumed
      // atomically on first use, and expire in 15 minutes.
      magicLink({
        disableSignUp: true,
        expiresIn: SIGN_IN_LINK_EXPIRES_IN_SECONDS,
        rateLimit: SIGN_IN_LINK_RATE_LIMIT,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          const owner = currentOwnerIssuance();
          if (owner) {
            if (owner.delivery === "copy") {
              owner.url = url;
              return;
            }
            await mailer.send(
              signInLinkEmail({
                to: email,
                name: owner.name,
                url,
                sentByOwner: true,
              }),
            );
            return;
          }
          // Anyone can ask, so the answer is the same whether or not the
          // address has an account that may receive one.
          const account = await options.db.query.authUser.findFirst({
            columns: {
              banned: true,
              email: true,
              emailVerified: true,
              name: true,
              realm: true,
              status: true,
              twoFactorEnabled: true,
            },
            where: eq(schema.authUser.email, email.trim().toLowerCase()),
          });
          if (!account || signInLinkRefusal(account) !== null) return;
          deliverInBackground(
            mailer.send(
              signInLinkEmail({ to: account.email, name: account.name, url }),
            ),
            "Sign-in link",
          );
        },
      }),
      username({
        maxUsernameLength: 255,
        minUsernameLength: 1,
        usernameValidator: (value) => value.trim().length > 0,
      }),
      jwt({
        jwt: { issuer: cloudAuthIssuer(options.baseURL) },
        schema: { jwks: { modelName: "authJwks" } },
      }),
      oauthProvider({
        loginPage: `${authAppUrl}/login`,
        consentPage: `${authAppUrl}/consent`,
        scopes: [
          "openid",
          "profile",
          "email",
          "offline_access",
          OAUTH_SUPERUSER_SCOPE,
          OAUTH_SERVICE_SCOPE,
        ],
        // Registration is open because MCP clients register themselves, so a
        // registered client must never be able to hold the machine scope.
        clientRegistrationDefaultScopes: [
          "openid",
          "profile",
          "email",
          "offline_access",
        ],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        resources: [
          {
            identifier: oauth.resources.api,
            name: "Cloud API",
            accessTokenTtl: MACHINE_ACCESS_TOKEN_SECONDS,
          },
          {
            identifier: oauth.resources.web,
            name: "denizlg24.com",
            accessTokenTtl: WEB_ACCESS_TOKEN_SECONDS,
          },
          { identifier: oauth.resources.mcp, name: "MCP" },
          { identifier: oauth.resources.status, name: "Status page" },
          { identifier: oauth.resources.macros, name: "Macros" },
        ],
        clientRegistrationDefaultResources: [oauth.resources.mcp],
        m2mAccessTokenExpiresIn: MACHINE_ACCESS_TOKEN_SECONDS,
        refreshTokenReuseInterval: REFRESH_REUSE_GRACE_SECONDS,
        // Three hooks, one feature: remember-me sessions get a stable,
        // non-expiring refresh handle. The request must run inside
        // `withOAuthRequestState` for them to see each other.
        storeTokens: rememberMe.storeTokens,
        customTokenResponseFields: rememberMe.customTokenResponseFields,
        formatRefreshToken: rememberMe.formatRefreshToken,
        clientPrivileges: async ({ user }) => {
          if (!user) return false;
          if (await isActiveSuperuser(options.db, user.id)) return true;
          return currentTenantClientGrant()?.userId === user.id;
        },
        customAccessTokenClaims: async ({ user, scopes, metadata }) => {
          // A tenant's client never carries `superuser`, whoever signs in:
          // the owner using someone's app is just another of its users.
          const tenantId = tenantOfClientMetadata(metadata);
          if (tenantId) {
            if (user === undefined) {
              if (!(await activeTenant(options.db, tenantId))) {
                throw denied("tenant_unavailable");
              }
              return { [OAUTH_TENANT_CLAIM]: tenantId };
            }
            if (!user) throw denied("account_inactive");
            const access = await tenantAccess(options.db, tenantId, user.id);
            if (!access.ok) throw denied(access.reason);
            return { [OAUTH_TENANT_CLAIM]: tenantId };
          }
          if (user === undefined) {
            // client_credentials. The client acts as whoever created it, so the
            // grant is only as good as that account still is.
            const owner =
              typeof metadata?.owner === "string" ? metadata.owner : null;
            if (
              !scopes.includes(OAUTH_SUPERUSER_SCOPE) ||
              !owner ||
              !(await isActiveSuperuser(options.db, owner))
            ) {
              throw denied("client owner is not an active superuser");
            }
            return { owner };
          }
          if (!user || !(await isActiveSuperuser(options.db, user.id))) {
            throw denied("superuser required");
          }
          return { [OAUTH_SUPERUSER_CLAIM]: true };
        },
        schema: {
          oauthClient: { modelName: "authOauthClient" },
          oauthResource: { modelName: "authOauthResource" },
          oauthClientResource: { modelName: "authOauthClientResource" },
          oauthRefreshToken: { modelName: "authOauthRefreshToken" },
          oauthAccessToken: { modelName: "authOauthAccessToken" },
          oauthConsent: { modelName: "authOauthConsent" },
          oauthClientAssertion: { modelName: "authOauthClientAssertion" },
        },
      }),
      // A TV signs in with a code someone approves on another device. Only a
      // client whose grant_types list the device-code grant may ask for one,
      // and issuance runs `customAccessTokenClaims` like any other grant.
      oauthDeviceAuthorization({
        verificationUri: `${authAppUrl}/device`,
        expiresIn: DEVICE_CODE_EXPIRES_IN,
        interval: "5s",
        schema: { deviceCode: { modelName: "authDeviceCode" } },
      }),
    ] as const,
    session: {
      additionalFields: {
        rememberMe: {
          defaultValue: false,
          input: false,
          required: false,
          type: "boolean",
        },
      },
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      modelName: "authSession",
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    trustedOrigins: [...(options.trustedOrigins ?? CLOUD_AUTH_TRUSTED_ORIGINS)],
    user: {
      additionalFields: {
        status: {
          defaultValue: "active",
          input: false,
          required: false,
          type: ["pending", "active"],
        },
        realm: {
          defaultValue: "public",
          input: false,
          required: false,
          type: ["cloud", "public"],
        },
        // Settable by the signed-in user through `updateUser`: the auth app's
        // "Never ask again" on the post-sign-in passkey offer.
        passkeyOfferDismissed: {
          defaultValue: false,
          input: true,
          required: false,
          type: "boolean",
        },
      },
      modelName: "authUser",
    },
    verification: {
      modelName: "authVerification",
    },
  });
}

export type CloudAuth = ReturnType<typeof createCloudAuth>;
