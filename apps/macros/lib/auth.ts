import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"

import { db } from "@/db/connection"
import { schema } from "@/db/schema"
import { sendEmail } from "@/lib/email"

const defaultPostVerificationPath = "/register/complete"
const vercelPreviewOriginPattern =
  "https://macros-*-denizlg24s-projects.vercel.app"

function toHttpsOrigin(host: string | undefined) {
  if (!host) return null
  return `https://${host.replace(/^https?:\/\//, "")}`
}

function getAuthBaseUrl() {
  if (process.env.VERCEL_ENV === "preview") {
    return (
      toHttpsOrigin(process.env.VERCEL_URL) ??
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3000"
    )
  }

  return (
    process.env.BETTER_AUTH_URL ??
    toHttpsOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    toHttpsOrigin(process.env.VERCEL_URL) ??
    "http://localhost:3000"
  )
}

function getTrustedOrigins() {
  return Array.from(
    new Set(
      [
        getAuthBaseUrl(),
        toHttpsOrigin(process.env.VERCEL_URL),
        toHttpsOrigin(process.env.VERCEL_BRANCH_URL),
        vercelPreviewOriginPattern,
      ].filter((origin): origin is string => Boolean(origin))
    )
  )
}

function getAppOrigin(request?: Request) {
  if (request) {
    return new URL(request.url).origin
  }

  return getAuthBaseUrl()
}

function getEmailVerificationUrl(token: string, request?: Request) {
  const url = new URL("/register/verify-email", getAppOrigin(request))
  url.searchParams.set("token", token)
  url.searchParams.set("callbackURL", defaultPostVerificationPath)

  return url.toString()
}

export const auth = betterAuth({
  baseURL: getAuthBaseUrl(),
  trustedOrigins: getTrustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  advanced: {
    cookiePrefix: "macros",
    useSecureCookies: !!process.env.VERCEL_URL,
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
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, token }, request) => {
      const verificationUrl = getEmailVerificationUrl(token, request)

      await sendEmail({
        to: user.email,
        subject: "Verify your Macros email",
        html: `<p>Verify your email address to finish setting up Macros:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
        text: `Verify your email address to finish setting up Macros: ${verificationUrl}`,
      })
    },
  },
  plugins: [nextCookies()],
})
