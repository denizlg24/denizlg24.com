import { isSuperuserToken } from "@repo/cloud-auth-client/resource";
import { type NextRequest, NextResponse } from "next/server";
import { clearCookie } from "@/lib/admin-redirects";
import {
  ADMIN_SESSION_COOKIE,
  cookieOptions,
  OAUTH_FLOW_COOKIE,
  openFlow,
  SESSION_MAX_AGE_SECONDS,
  sealSession,
  verifySiteAccessToken,
} from "@/lib/admin-session";
import {
  cloudOAuthConfig,
  exchangeCode,
  OAuthGrantError,
} from "@/lib/cloud-oauth";

function refused(status: number, reason: string) {
  const response = new NextResponse(`sign-in failed: ${reason}`, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
  });
  clearCookie(response, OAUTH_FLOW_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const config = cloudOAuthConfig();
  const params = request.nextUrl.searchParams;
  const flow = await openFlow(request.cookies.get(OAUTH_FLOW_COOKIE)?.value);
  if (!flow || params.get("state") !== flow.state) {
    return refused(400, "state mismatch");
  }
  // RFC 9207: a response that names a different issuer is a mix-up attempt.
  const issuer = params.get("iss");
  if (issuer !== null && issuer !== config.issuer) {
    return refused(400, "issuer mismatch");
  }
  const error = params.get("error");
  if (error) return refused(403, error);
  const code = params.get("code");
  if (!code) return refused(400, "missing code");

  let session: string;
  try {
    const tokens = await exchangeCode(config, {
      code,
      verifier: flow.verifier,
    });
    const verified = await verifySiteAccessToken(tokens.access_token);
    if (!verified || !isSuperuserToken(verified)) {
      return refused(403, "superuser required");
    }
    session = await sealSession(tokens);
  } catch (caught) {
    if (caught instanceof OAuthGrantError) {
      return refused(caught.status, caught.code ?? "token exchange refused");
    }
    throw caught;
  }

  const site = new URL(config.redirectUri).origin;
  const response = NextResponse.redirect(new URL(flow.destination, site));
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    session,
    cookieOptions(SESSION_MAX_AGE_SECONDS),
  );
  clearCookie(response, OAUTH_FLOW_COOKIE);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
