import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/db/connection";
import { schema } from "@/db/schema";
import { sendEmail } from "@/lib/email";

const defaultPostVerificationPath = "/register/complete";
const productionOrigin = "https://macros.denizlg24.com";
const forgeDeploymentOriginPattern = "https://macros-*.denizlg24.com";

function getAuthBaseUrl() {
  return process.env.MACROS_BETTER_AUTH_URL ?? "http://localhost:3000";
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

function getAppOrigin(request?: Request) {
  if (request) {
    return new URL(request.url).origin;
  }

  return getAuthBaseUrl();
}

function getEmailVerificationUrl(token: string, request?: Request) {
  const url = new URL("/register/verify-email", getAppOrigin(request));
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
      await sendEmail({
        to: user.email,
        subject: "Reset your Macros password",
        html: `<p>Use this link to reset your password:</p><p><a href="${url}">${url}</a></p>`,
        text: `Use this link to reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, token }, request) => {
      const verificationUrl = getEmailVerificationUrl(token, request);

      await sendEmail({
        to: user.email,
        subject: "Verify your Macros email",
        html: `<p>Verify your email address to finish setting up Macros:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
        text: `Verify your email address to finish setting up Macros: ${verificationUrl}`,
      });
    },
  },
  plugins: [nextCookies()],
});
