import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { type Database, hashPassword, verifyPassword } from "@repo/cloud-core";
import * as schema from "@repo/cloud-core/db/schema";
import {
  AUTH_APP_URL,
  OAUTH_RESOURCES,
  OAUTH_SUPERUSER_CLAIM,
  OAUTH_SUPERUSER_SCOPE,
  type OAuthResourceKey,
} from "@repo/schemas/cloud";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin, jwt, twoFactor, username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { z } from "zod";

const SESSION_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;
const MACHINE_ACCESS_TOKEN_SECONDS = 5 * 60;
const WEB_ACCESS_TOKEN_SECONDS = 15 * 60;
// A browser that loads an admin page fires several requests at once, and each
// one finds the same expired access token. Without a grace window the second
// refresh is indistinguishable from a stolen token being replayed, and the
// whole grant is revoked.
const REFRESH_REUSE_GRACE_SECONDS = 30;

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
}

const uuidSchema = z.uuid();

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
      columns: { banned: true, status: true, twoFactorEnabled: true },
      where: eq(schema.authUser.id, userId),
    }),
  ]);
  return (
    legacy?.role === "superuser" &&
    account?.status === "active" &&
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

export function cloudAuthIssuer(baseURL: string): string {
  return `${baseURL.replace(/\/$/, "")}/api/auth`;
}

export function createCloudAuth(options: CloudAuthOptions) {
  const oauth = options.oauth ?? DEFAULT_CLOUD_OAUTH_CONFIG;
  const authAppUrl = oauth.authAppUrl.replace(/\/$/, "");
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
    databaseHooks: {
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
      disableSignUp: true,
      enabled: true,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
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
        twoFactorTable: "authTwoFactor",
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
        ],
        clientRegistrationDefaultResources: [oauth.resources.mcp],
        m2mAccessTokenExpiresIn: MACHINE_ACCESS_TOKEN_SECONDS,
        refreshTokenReuseInterval: REFRESH_REUSE_GRACE_SECONDS,
        clientPrivileges: async ({ user }) =>
          user ? isActiveSuperuser(options.db, user.id) : false,
        customAccessTokenClaims: async ({ user, scopes, metadata }) => {
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
    ] as const,
    session: {
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
      },
      modelName: "authUser",
    },
    verification: {
      modelName: "authVerification",
    },
  });
}

export type CloudAuth = ReturnType<typeof createCloudAuth>;
