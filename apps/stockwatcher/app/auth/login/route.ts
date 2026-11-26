import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { dashboardReturn } from "@/lib/assistant-types";
import {
  appOrigin,
  authReady,
  cookieOptions,
  flowCookie,
  oidcConfiguration,
} from "@/lib/auth";

export async function GET(request: Request) {
  if (!authReady())
    return NextResponse.redirect(new URL("/?auth=setup", request.url));
  const origin = appOrigin();
  try {
    const config = await oidcConfiguration();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const target = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${origin}/auth/callback`,
      scope: "openid profile email",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    const response = NextResponse.redirect(target);
    response.cookies.set(
      flowCookie(origin),
      JSON.stringify({
        verifier,
        state,
        nonce,
        from: dashboardReturn(new URL(request.url).searchParams.get("from")),
      }),
      cookieOptions(origin, 600),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error(
      "Deniz Cloud authorization setup failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return NextResponse.redirect(new URL("/?auth=unavailable", origin));
  }
}
