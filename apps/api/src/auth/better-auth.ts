import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type Database, hashPassword, verifyPassword } from "@repo/cloud-core";
import * as schema from "@repo/cloud-core/db/schema";
import { betterAuth } from "better-auth";
import { admin, twoFactor, username } from "better-auth/plugins";
import { eq } from "drizzle-orm";

const SESSION_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

export const CLOUD_AUTH_TRUSTED_ORIGINS = [
  "https://cloud.denizlg24.com",
  "https://storage.denizlg24.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
] as const;

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
