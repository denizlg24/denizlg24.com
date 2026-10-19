import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { db } from "@/db/connection";
import { schema } from "@/db/schema";
import { deleteAccountData } from "@/lib/account/delete";
import { getEmailVerificationUrl } from "@/lib/account/email-change";
import {
  createAuthEmail,
  getPublicAppOrigin,
  getPublicAppUrl,
  sendEmail,
} from "@/lib/email";
import { isSuspended } from "@/lib/moderation/service";

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
    // A verified user confirms from the current address first; that link
    // mails the new address, and only verifying it applies the change.
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, token }) => {
        const email = createAuthEmail({
          actionLabel: "Confirm change",
          actionUrl: getEmailVerificationUrl(token, "confirmed"),
          body: `Someone asked to change the email on your Macros account to ${newEmail}. If that was you, confirm below and we will send a link to the new address to finish. If it was not, ignore this email and nothing changes.`,
          preheader: "Confirm the new email for your Macros account.",
          title: "Confirm your new email",
        });
        await sendEmail({
          to: user.email,
          subject: "Confirm your new Macros email",
          ...email,
        });
      },
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await deleteAccountData(user.id);
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          if (await isSuspended(session.userId)) {
            throw new APIError("FORBIDDEN", {
              message:
                "This account has been suspended. Contact geral@oceaninformatix.com.",
            });
          }
        },
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
      // Better Auth only mails an already verified user to verify the address
      // they are changing to, which `user.email` holds here.
      if (user.emailVerified) {
        const email = createAuthEmail({
          actionLabel: "Verify new email",
          actionUrl: getEmailVerificationUrl(token, "verified"),
          body: "Verify this address to finish moving your Macros account to it. Until you do, keep signing in with your current email.",
          preheader: "Verify the new email for your Macros account.",
          title: "Verify your new email",
        });
        await sendEmail({
          to: user.email,
          subject: "Verify your new Macros email",
          ...email,
        });
        return;
      }

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
