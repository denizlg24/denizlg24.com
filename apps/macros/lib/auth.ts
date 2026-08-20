import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/db/connection";
import { schema } from "@/db/schema";
import {
  createAuthEmail,
  getPublicAppOrigin,
  getPublicAppUrl,
  sendEmail,
} from "@/lib/email";

const defaultPostVerificationPath = "/register/complete";
const productionOrigin = "https://macros.denizlg24.com";
const forgeDeploymentOriginPattern = "https://macros-*.denizlg24.com";

function getAuthBaseUrl() {
  return getPublicAppOrigin();
}

function getTrustedOrigins() {
  return Array.from(
    new Set(
      [getAuthBaseUrl(), productionOrigin, forgeDeploymentOriginPattern].filter(
        (origin): origin is string => Boolean(origin),
      ),
    ),
  );
}

function getEmailVerificationUrl(token: string) {
  const url = new URL("/register/verify-email", getAuthBaseUrl());
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", defaultPostVerificationPath);

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
  plugins: [nextCookies()],
});
