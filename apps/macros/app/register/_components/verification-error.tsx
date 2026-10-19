import Link from "next/link";
import { primaryButton } from "@/app/_landing/site";

const GET_NEW_LINK_IN_APP = "Sign in from the Macros app to get a new one.";
const START_CHANGE_AGAIN = "Start the change again from your account page.";

// Keyed by Better Auth's error codes, which it appends to the callback URL as
// `?error=` when a verification link is refused. `next` is what to do about it
// after signing up in the app; an email change always starts again from the
// account page.
const ERROR_MESSAGES: Record<
  string,
  { title: string; reason: string; next: string | null }
> = {
  INVALID_TOKEN: {
    title: "Link is invalid",
    reason: "This verification link is malformed or has already been used.",
    next: GET_NEW_LINK_IN_APP,
  },
  TOKEN_EXPIRED: {
    title: "Link has expired",
    reason: "Verification links expire after an hour.",
    next: GET_NEW_LINK_IN_APP,
  },
  USER_NOT_FOUND: {
    title: "Account not found",
    reason: "There is no Macros account for this link.",
    next: "Sign up again from the app.",
  },
  INVALID_USER: {
    title: "Different account",
    reason:
      "This link belongs to another account than the one signed in on this browser. Sign out, then open the link again.",
    next: null,
  },
};

export function VerificationError({
  error,
  emailChange = false,
}: {
  error: string;
  emailChange?: boolean;
}) {
  const {
    title,
    reason,
    next: nextInApp,
  } = ERROR_MESSAGES[error] ?? {
    title: "Verification failed",
    reason: "Something went wrong verifying your email.",
    next: "Sign in from the Macros app to get a new link.",
  };
  const next = nextInApp && emailChange ? START_CHANGE_AGAIN : nextInApp;

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {next ? `${reason} ${next}` : reason}
        </p>
      </div>
      {emailChange ? (
        <Link href="/account" className={`${primaryButton} w-full`}>
          Go to your account
        </Link>
      ) : (
        <a href="macros://sign-in" className={`${primaryButton} w-full`}>
          Open Macros
        </a>
      )}
    </div>
  );
}
