import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { db } from "@/db/connection";
import { schema } from "@/db/schema";
import { deleteAccountData } from "@/lib/account/delete";
import {
  createAuthEmail,
  getPublicAppOrigin,
  getPublicAppUrl,
  sendEmail,
} from "@/lib/email";

// Verification links are opened in a browser, usually on the phone, and the
// app picks up from there. Better Auth appends `?error=` to this path when the
// token is bad, so the page renders both outcomes.
const postVerificationPath = "/register/verified";
const productionOrigin = "https://macros.denizlg24.com";
const forgeDeploymentOriginPattern = "https://macros-*.denizlg24.com";
const nativeAppOrigin = "macros://";

function getAuthBaseUrl() {
  return getPublicAppOrigin();
}

function getTrustedOrigins() {
  return Array.from(
    new Set(
      [
        getAuthBaseUrl(),
        productionOrigin,
        forgeDeploymentOriginPattern,
        nativeAppOrigin,
      ].filter((origin): origin is string => Boolean(origin)),
    ),
  );
}

function getEmailVerificationUrl(token: string) {
  const url = new URL("/register/verify-email", getAuthBaseUrl());
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", postVerificationPath);

  return url.toString();
}

export const auth = betterAuth({
  baseURL: getAuthBaseUrl(),
  secret: process.env.MACROS_BETTER_AUTH_SECRET,
  trustedOrigins: getTrustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  advanced: {
    cookiePrefix: "macros",
    useSecureCookies: process.env.MACROS_BETTER_AUTH_SECURE_COOKIES === "true",
  },
  session: {
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await deleteAccountData(user.id);
      },
    },
  },
  hooks: {
    // Without a password, Better Auth deletes the account for any session
    // younger than a day. Deleting everything is never that casual.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/delete-user") return;
      const password: unknown = ctx.body?.password;
      if (typeof password !== "string" || password.length === 0) {
        throw new APIError("BAD_REQUEST", {
          message: "Enter your password to delete your account.",
        });
      }
    }),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const resetUrl = getPublicAppUrl(url);
      const email = createAuthEmail({
        actionLabel: "Reset password",
        actionUrl: resetUrl,
        body: "Use the button below to choose a new password for your Macros account. If you did not request this, you can safely ignore this email.",
        preheader: "Reset your Macros password.",
        title: "Reset your password",
      });
      await sendEmail({
        to: user.email,
        subject: "Reset your Macros password",
        ...email,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, token }) => {
      const verificationUrl = getEmailVerificationUrl(token);
      const email = createAuthEmail({
        actionLabel: "Verify email",
        actionUrl: verificationUrl,
        body: "Confirm your email address to finish setting up Macros and start tracking your nutrition.",
        preheader: "Confirm your email address to finish setting up Macros.",
        title: "Verify your email",
      });

      await sendEmail({
        to: user.email,
        subject: "Verify your Macros email",
        ...email,
      });
    },
  },
  plugins: [expo()],
});
