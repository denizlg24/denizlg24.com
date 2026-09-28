import { primaryButton } from "@/app/_landing/site";

// Keyed by Better Auth's error codes, which it appends to the callback URL as
// `?error=` when a verification link is refused.
const ERROR_MESSAGES: Record<string, { title: string; body: string }> = {
  INVALID_TOKEN: {
    title: "Link is invalid",
    body: "This verification link is malformed or has already been used. Sign in from the Macros app to get a new one.",
  },
  TOKEN_EXPIRED: {
    title: "Link has expired",
    body: "Verification links expire after an hour. Sign in from the Macros app to get a new one.",
  },
  USER_NOT_FOUND: {
    title: "Account not found",
    body: "There is no Macros account for this link. Sign up again from the app.",
  },
};

export function VerificationError({ error }: { error: string }) {
  const known = ERROR_MESSAGES[error];
  const title = known?.title ?? "Verification failed";
  const body =
    known?.body ??
    "Something went wrong verifying your email. Sign in from the Macros app to get a new link.";

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      <a href="macros://sign-in" className={`${primaryButton} w-full`}>
        Open Macros
      </a>
    </div>
  );
}
