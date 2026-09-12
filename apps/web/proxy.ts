import { type NextRequest, NextResponse } from "next/server";
import { clearCookie } from "@/lib/admin-redirects";
import {
  ADMIN_SESSION_COOKIE,
  cookieOptions,
  openSession,
  SESSION_MAX_AGE_SECONDS,
  sealSession,
  withCookie,
} from "@/lib/admin-session";
import {
  cloudOAuthConfig,
  OAuthGrantError,
  refreshTokens,
} from "@/lib/cloud-oauth";

const REFRESH_MARGIN_SECONDS = 60;

/**
 * Keeps the admin session's short-lived access token fresh. Route handlers and
 * pages only verify; the refresh has to happen here, the one place that can
 * both rewrite the incoming request's cookie — so the handler in this same
 * request sees the new token — and set it on the response.
 */
export async function proxy(request: NextRequest) {
  const raw = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!raw) return NextResponse.next();

  const session = await openSession(raw);
  if (!session) {
    const response = NextResponse.next();
    clearCookie(response, ADMIN_SESSION_COOKIE);
    return response;
  }
  if (session.exp - Date.now() / 1000 > REFRESH_MARGIN_SECONDS) {
    return NextResponse.next();
  }

  let sealed: string;
  try {
    sealed = await sealSession(
      await refreshTokens(cloudOAuthConfig(), session.rt),
    );
  } catch (error) {
    // Neither outcome clears the cookie. An unreachable cloud is no reason to
    // sign anyone out, and a refused grant is not always a dead one: a second
    // container refreshing the same token in the same instant loses the race
    // with `invalid_grant` while the winner's response carries a good cookie,
    // and clearing here could land after it. A grant that really is gone
    // costs one refused refresh per request until the next page load signs in
    // again and replaces the cookie.
    console.error(
      error instanceof OAuthGrantError
        ? "Admin session refresh refused"
        : "Admin session refresh failed",
      error,
    );
    return NextResponse.next();
  }

  const headers = new Headers(request.headers);
  headers.set(
    "cookie",
    withCookie(headers.get("cookie"), ADMIN_SESSION_COOKIE, sealed),
  );
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    sealed,
    cookieOptions(SESSION_MAX_AGE_SECONDS),
  );
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/blog/comments/:path*"],
};
