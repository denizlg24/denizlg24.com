import { type NextRequest, NextResponse } from "next/server";
import * as oidc from "openid-client";
import { dashboardReturn } from "@/lib/assistant-types";
import {
  accountAllowed,
  appOrigin,
  authReady,
  cookieOptions,
  flowCookie,
  issuer,
  oidcConfiguration,
  sessionCookie,
} from "@/lib/auth";
import { createSession, deleteSession, sessionAge } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!authReady())
    return NextResponse.redirect(new URL("/?auth=setup", request.url));
  const origin = appOrigin();
  const response = NextResponse.redirect(new URL("/", origin));
  response.headers.set("Cache-Control", "no-store");
  const stored = request.cookies.get(flowCookie(origin))?.value;
  response.cookies.set(flowCookie(origin), "", cookieOptions(origin, 0));
  try {
    if (!stored) throw new Error("Missing sign-in attempt");
    const { verifier, state, nonce, from } = JSON.parse(stored);
    if (
      ![verifier, state, nonce].every(
        (value) => typeof value === "string" && value.length > 20,
      )
    )
      throw new Error("Invalid sign-in attempt");
    const callback = new URL("/auth/callback", origin);
    callback.search = request.nextUrl.search;
    const config = await oidcConfiguration();
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: verifier,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("Deniz Cloud identity not returned");
    const profile = await oidc
      .fetchUserInfo(config, tokens.access_token, claims.sub)
      .catch(() => claims);
    const name = [profile.name, profile.preferred_username, profile.email].find(
      (value) => typeof value === "string" && value.trim(),
    );
    const identity = {
      id: `${issuer()}|${claims.sub}`,
      name: typeof name === "string" ? name.slice(0, 180) : "Deniz Cloud user",
      email: typeof profile.email === "string" ? profile.email : null,
      emailVerified: profile.email_verified === true,
      demo: false,
    };
    if (!accountAllowed(identity)) {
      response.headers.set(
        "Location",
        new URL("/?auth=restricted", origin).toString(),
      );
      return response;
    }
    const token = await createSession(identity);
    const destination = new URL("/", origin);
    destination.hash = dashboardReturn(from);
    response.headers.set("Location", destination.toString());
    const prior = request.cookies.get(sessionCookie(origin))?.value;
    if (prior) await deleteSession(prior);
    response.cookies.set(
      sessionCookie(origin),
      token,
      cookieOptions(origin, sessionAge),
    );
  } catch (error) {
    console.error(
      "Deniz Cloud callback failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    const status = request.nextUrl.searchParams.has("error")
      ? "declined"
      : "retry";
    response.headers.set(
      "Location",
      new URL(`/?auth=${status}`, origin).toString(),
    );
  }
  return response;
}
