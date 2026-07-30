import { type NextRequest, NextResponse } from "next/server";

/**
 * Enable Banking's whitelisted redirect target.
 *
 * Stays a route handler because the URL is registered with the provider and
 * cannot change without re-whitelisting, but it does nothing beyond forwarding
 * the callback to `/admin/finance/link`. The handshake needs a real page: the
 * bank redirects the *browser* here carrying a cookie session and never the
 * desktop app's Bearer token, so an unauthenticated arrival has to be resumable
 * through login — and login navigates client-side, which a route handler cannot
 * serve.
 */
export function GET(request: NextRequest) {
  const target = new URL("/admin/finance/link", request.url);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target);
}
