import Link from "next/link"
import { redirect } from "next/navigation"
import { pageMetadata } from "@/app/metadata"

export const metadata = pageMetadata(
  "Verify Email",
  "Verify your email address to continue setting up Macros."
)

interface VerifyEmailPageProps {
  searchParams: Promise<{
    token?: string | string[]
    callbackURL?: string | string[]
    error?: string | string[]
  }>
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getSafeCallbackPath(value: string | undefined) {
  if (!value?.startsWith("/")) return "/register/complete"
  if (value.startsWith("//")) return "/register/complete"
  return value
}

const ERROR_MESSAGES: Record<string, { title: string; body: string }> = {
  invalid_token: {
    title: "Link is invalid",
    body: "This verification link is malformed or has already been used. Request a new one by signing up again.",
  },
  token_expired: {
    title: "Link has expired",
    body: "Verification links expire after 24 hours. Sign up again to get a fresh link.",
  },
  email_already_verified: {
    title: "Already verified",
    body: "This email is already verified. Sign in to continue.",
  },
}

function VerificationError({ error }: { error: string }) {
  const known = ERROR_MESSAGES[error]
  const title = known?.title ?? "Verification failed"
  const body =
    known?.body ??
    "Something went wrong verifying your email. Try signing up again."

  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center text-sm font-medium underline underline-offset-4"
      >
        Back to sign in
      </Link>
    </div>
  )
}

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams
  const token = getSingleParam(params.token)
  const callbackURL = getSafeCallbackPath(getSingleParam(params.callbackURL))
  const error = getSingleParam(params.error)

  if (error) {
    return <VerificationError error={error} />
  }

  if (!token) {
    return <VerificationError error="invalid_token" />
  }

  const verifyUrl = new URL("/api/auth/verify-email", "http://localhost")
  verifyUrl.searchParams.set("token", token)
  verifyUrl.searchParams.set("callbackURL", callbackURL)

  redirect(`${verifyUrl.pathname}${verifyUrl.search}`)
}
