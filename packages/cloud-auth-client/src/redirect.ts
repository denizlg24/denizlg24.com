import { AUTH_APP_URL, DEV_AUTH_APP_URL } from "@repo/schemas/cloud";

// A production build needs nothing configured; a dev server lands on the local
// auth app rather than signing into production from localhost.
export const AUTH_APP_BASE_URL = (
  process.env.NEXT_PUBLIC_AUTH_APP_URL ??
  (process.env.NODE_ENV === "production" ? AUTH_APP_URL : DEV_AUTH_APP_URL)
).replace(/\/$/, "");

const COOKIE_DOMAIN = "denizlg24.com";

/**
 * The only post-login destinations the auth app will navigate to. Every host
 * under the cookie domain already receives the session cookie, so sending the
 * browser to one hands it nothing it did not have; anywhere else would.
 */
export function safeReturnTo(
  value: string | null | undefined,
  options: { allowLoopback?: boolean } = {},
): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (
    options.allowLoopback &&
    url.protocol === "http:" &&
    (host === "localhost" || host === "127.0.0.1")
  ) {
    return url.toString();
  }
  if (url.protocol !== "https:" || url.port) return null;
  if (host !== COOKIE_DOMAIN && !host.endsWith(`.${COOKIE_DOMAIN}`)) {
    return null;
  }
  return url.toString();
}

export function authLoginUrl(
  returnTo: string,
  params: Record<string, string> = {},
): string {
  const url = new URL("/login", AUTH_APP_BASE_URL);
  url.searchParams.set("returnTo", returnTo);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function authLogoutUrl(returnTo: string): string {
  const url = new URL("/logout", AUTH_APP_BASE_URL);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}
