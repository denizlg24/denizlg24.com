import { authLogoutUrl } from "@repo/cloud-auth-client/redirect";
import { type NextRequest, NextResponse } from "next/server";
import { clearCookie } from "@/lib/admin-redirects";
import { ADMIN_SESSION_COOKIE, openSession } from "@/lib/admin-session";
import { cloudOAuthConfig, revokeRefreshToken } from "@/lib/cloud-oauth";

/**
 * Ends this site's grant, then hands the browser to the auth app to end the
 * cloud session too — signing out of only one would be undone by the next
 * admin page load, which signs straight back in through the live cloud session.
 */
export async function POST(request: NextRequest) {
  const config = cloudOAuthConfig();
  const site = new URL(config.redirectUri).origin;
  if (request.headers.get("origin") !== site) {
    return new NextResponse(null, { status: 403 });
  }
  const session = await openSession(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (session) {
    await revokeRefreshToken(config, session.rt).catch((error) => {
      console.error("Refresh token revocation failed", error);
    });
  }
  const response = NextResponse.redirect(authLogoutUrl(site), 303);
  clearCookie(response, ADMIN_SESSION_COOKIE);
  return response;
}
