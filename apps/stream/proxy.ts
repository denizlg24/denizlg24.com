import { type NextRequest, NextResponse } from "next/server";

import { auth, sessionCookieName } from "@/lib/auth";
import { streamBaseUrl } from "@/lib/config";
import { devSubject } from "@/lib/dev-session";

const PUBLIC_PATHS = new Set(["/sign-in", "/auth/session"]);

/**
 * A document request with no session cookie goes straight to sign-in with a
 * real redirect; a page behind a loading boundary would otherwise stream its
 * shell first. Native clients call `/api/*` with a bearer and are left alone.
 */
function isSignedOutDocument(request: NextRequest): boolean {
  return (
    request.method === "GET" &&
    !PUBLIC_PATHS.has(request.nextUrl.pathname) &&
    !request.nextUrl.pathname.startsWith("/api/") &&
    !request.headers.has("rsc") &&
    !request.headers.has("next-action") &&
    !request.cookies.has(sessionCookieName())
  );
}

export function proxy(request: NextRequest) {
  if (request.headers.has("authorization") || devSubject()) {
    return NextResponse.next();
  }
  if (isSignedOutDocument(request)) {
    const { pathname, search } = request.nextUrl;
    return NextResponse.redirect(
      new URL(auth.loginUrl(`${pathname}${search}`), streamBaseUrl()),
    );
  }
  return auth.proxy(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|auth/|healthz|api/jobs|api/public|robots\\.txt|favicon\\.ico|icon\\.png|apple-icon\\.png).*)",
    "/auth/session",
  ],
};
