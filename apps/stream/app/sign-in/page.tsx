import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/top-bar";
import { auth } from "@/lib/auth";
import { authAppUrl, streamBaseUrl } from "@/lib/config";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  access_denied:
    "Signing in was cancelled. You can try again whenever you like.",
  unavailable:
    "We couldn't reach the sign-in service. Please try again in a minute.",
  state_mismatch: "That sign-in took a little too long. Please try again.",
  invalid_token: "Something went wrong while signing you in. Please try again.",
};

function localPath(value: string | string[] | undefined): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return "/";
  }
  return value;
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const error =
    typeof params.auth_error === "string" ? params.auth_error : null;
  const returnTo = localPath(params.returnTo);
  const session = error ? null : await auth.getSession().catch(() => null);
  if (session) redirect(returnTo);
  const forbidden = error === "forbidden";

  const signOut = new URL("/logout", authAppUrl());
  signOut.searchParams.set("returnTo", `${streamBaseUrl()}/sign-in`);

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_20%,rgba(242,181,74,0.14),transparent_70%),radial-gradient(50%_40%_at_80%_90%,rgba(232,116,59,0.10),transparent_70%)]"
      />
      <div className="relative flex w-full max-w-md flex-col items-start gap-10 animate-rise">
        <Wordmark className="text-5xl" />
        <div className="space-y-4">
          <h1 className="font-display text-5xl leading-[1.05] md:text-6xl">
            {forbidden
              ? "Not on the guest list yet"
              : "Films and series, for the family."}
          </h1>
          <p className="text-lg leading-relaxed text-muted">
            {forbidden
              ? "This account hasn't been invited to Stream. Ask Deniz to send you an invitation, then sign in again with the same email address."
              : "Sign in with your deniz account to pick up where you left off. If you don't have one yet, ask Deniz for an invitation."}
          </p>
        </div>
        {forbidden ? (
          <a
            href={signOut.toString()}
            data-nav
            data-nav-autofocus
            className="rounded-full bg-paper px-8 py-4 text-lg font-medium text-ink transition-transform hover:scale-[1.02]"
          >
            Use a different account
          </a>
        ) : (
          <a
            href={auth.loginUrl(returnTo)}
            data-nav
            data-nav-autofocus
            className="rounded-full bg-amber px-8 py-4 text-lg font-medium text-ink transition-transform hover:scale-[1.02]"
          >
            Sign in
          </a>
        )}
        {error && !forbidden ? (
          <p role="alert" className="text-sm text-ember">
            {ERRORS[error] ??
              "Something went wrong while signing you in. Please try again."}
          </p>
        ) : null}
      </div>
    </main>
  );
}
