import { ThemeToggle } from "@repo/cloud-ui/theme";
import { Button } from "@repo/ui/button";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/wordmark";
import { adminBaseUrl, auth, authAppUrl, isOwnerToken } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  access_denied: "Sign-in declined",
  unavailable: "Sign-in unavailable",
  state_mismatch: "Sign-in expired",
  invalid_token: "Token refused",
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

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex justify-end px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-24">
        {children}
      </main>
    </div>
  );
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const error =
    typeof params.auth_error === "string" ? params.auth_error : null;
  const returnTo = localPath(params.returnTo);

  const session =
    error === "forbidden" ? null : await auth.getSession().catch(() => null);
  const forbidden =
    error === "forbidden" || (session !== null && !isOwnerToken(session.token));
  if (session && !forbidden && !error) redirect(returnTo);

  if (forbidden) {
    const signOut = new URL("/logout", authAppUrl());
    signOut.searchParams.set("returnTo", `${adminBaseUrl()}/`);
    return (
      <Frame>
        <Wordmark size="large" />
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-base font-medium text-accent-strong">
            Not allowed
          </h1>
          <a
            href={signOut.toString()}
            className="rounded-sm text-sm text-muted-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Sign out
          </a>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="sr-only">Sign in</h1>
      <Wordmark size="large" />
      <div className="flex w-full max-w-60 flex-col items-stretch gap-3">
        <Button asChild size="lg">
          <a href={auth.loginUrl(returnTo)}>Sign in</a>
        </Button>
        {error ? (
          <p role="alert" className="text-center text-xs text-danger">
            {ERRORS[error] ?? "Sign-in failed"}
            <span className="ml-1.5 font-mono text-muted-foreground">
              {error}
            </span>
          </p>
        ) : null}
      </div>
    </Frame>
  );
}
