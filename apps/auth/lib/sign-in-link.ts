/**
 * Where a sign-in link lands. Always this app's `/login`, which the API
 * trusts; the destination rides along as `returnTo`, and the API refuses one
 * outside the owner's allow-list. A relative destination is this app itself,
 * which `/login` reaches without being told.
 */
export function signInLinkCallbacks(
  origin: string,
  destination: string,
): { callbackURL: string; errorCallbackURL: string } {
  const callback = new URL("/login", origin);
  if (!destination.startsWith("/")) {
    callback.searchParams.set("returnTo", destination);
  }
  const errorCallback = new URL(callback);
  errorCallback.searchParams.set("signInLink", "error");
  return {
    callbackURL: callback.toString(),
    errorCallbackURL: errorCallback.toString(),
  };
}

/** What `/login` says when a link sent the browser back with an error. */
export function signInLinkErrorMessage(error: string | null): string {
  switch (error) {
    case "ACCOUNT_UNAVAILABLE":
      return "That sign-in link can't be used with this account. Sign in another way, or ask whoever runs your account.";
    case "INVALID_LINK":
      return "That sign-in link isn't complete. Open it straight from the email, or ask for a new one.";
    default:
      return "That sign-in link has expired or was already used. Each link works once, for 15 minutes — ask for a new one.";
  }
}
