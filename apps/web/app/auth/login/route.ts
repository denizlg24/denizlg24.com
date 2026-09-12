import { type NextRequest, NextResponse } from "next/server";
import { safeDestination } from "@/lib/admin-redirects";
import {
  cookieOptions,
  flowCookieMaxAge,
  OAUTH_FLOW_COOKIE,
  sealFlow,
} from "@/lib/admin-session";
import {
  authorizationUrl,
  cloudOAuthConfig,
  randomToken,
} from "@/lib/cloud-oauth";

/**
 * Starts an authorization-code flow against the cloud. With a live cloud
 * session the authorization server answers straight back to /auth/callback —
 * this site is a trusted client with no consent step — so an already
 * signed-in owner never sees a form.
 */
export async function GET(request: NextRequest) {
  const config = cloudOAuthConfig();
  const flow = {
    state: randomToken(),
    verifier: randomToken(),
    destination: safeDestination(
      request.nextUrl.searchParams.get("callbackUrl"),
    ),
  };
  const response = NextResponse.redirect(await authorizationUrl(config, flow));
  response.cookies.set(
    OAUTH_FLOW_COOKIE,
    await sealFlow(flow),
    cookieOptions(flowCookieMaxAge()),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
