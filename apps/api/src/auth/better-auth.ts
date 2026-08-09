import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type Database, hashPassword, verifyPassword } from "@repo/cloud-core";
import * as schema from "@repo/cloud-core/db/schema";
import { betterAuth } from "better-auth";
import { admin, twoFactor, username } from "better-auth/plugins";
import { eq } from "drizzle-orm";

const SESSION_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

// Dev ports, one per app: 3000 web, 3001 api, 3002 cloud, 3005 storage,
// 3006 forge.
// (3003 is the terminal service, 3004 the desktop shell's Next server —
// neither talks to better-auth from a browser origin.)
export const CLOUD_AUTH_TRUSTED_ORIGINS = [
  "https://cloud.denizlg24.com",
  "https://forge.denizlg24.com",
  // The Forge dashboard has to authenticate on its generated hostname before
  // it can take over forge.denizlg24.com. Scope the wildcard to this one
  // project; trusting every deployment hostname would let unrelated preview
  // code make credentialed requests to the cloud API.
  "https://forge-server-*.denizlg24.com",
  "https://storage.denizlg24.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3005",
  "http://localhost:3006",
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

export interface CloudAuthOptions {
  db: Database;
  baseURL: string;
  secret: string;
  cookieDomain?: string;
  trustedOrigins?: readonly string[];
}

export function createCloudAuth(options: CloudAuthOptions) {
  return betterAuth({
    appName: "Deniz Cloud",
    baseURL: options.baseURL,
    secret: options.secret,
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
