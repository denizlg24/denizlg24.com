import { type NextRequest, NextResponse } from "next/server";

import { adminBaseUrl, auth, sessionCookieName } from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/sign-in", "/auth/session"]);

/**
 * A document request with no session cookie at all goes straight to sign-in
 * with a real redirect; pages behind a loading boundary would otherwise stream
 * the shell first and redirect from the client.
 */
function isSignedOutDocument(request: NextRequest): boolean {
  return (
    request.method === "GET" &&
    !PUBLIC_PATHS.has(request.nextUrl.pathname) &&
    !request.headers.has("rsc") &&
    !request.headers.has("next-action") &&
    !request.cookies.has(sessionCookieName())
  );
}

export function proxy(request: NextRequest) {
  if (isSignedOutDocument(request)) {
    const { pathname, search } = request.nextUrl;
    return NextResponse.redirect(
      new URL(auth.loginUrl(`${pathname}${search}`), adminBaseUrl()),
    );
  }
  return auth.proxy(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|auth/|healthz|robots\\.txt|favicon\\.ico|icon\\.png|apple-icon\\.png).*)",
    "/auth/session",
  ],
};
