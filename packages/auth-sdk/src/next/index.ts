import { cookies } from "next/headers.js";
import { redirect } from "next/navigation.js";
import { type NextRequest, NextResponse } from "next/server.js";
import { withCookie } from "./cookies.js";
import {
  type ConfigSource,
  type DenizSession,
  handle,
  lazyResolver,
  loginPath,
  refreshFromCookie,
  sessionFromCookie,
} from "./core.js";

export type { AccessToken } from "../server/verifier.js";
export type { DenizAuthConfig, DenizSession, SessionPayload } from "./core.js";

export interface DenizAuth {
  /** Mount at `app/<basePath>/[...deniz]/route.ts`: `export const { GET, POST } = auth;` */
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  /**
   * Keeps the access token fresh. Call it from `proxy.ts` (or `middleware.ts`)
   * on every path that reads the session.
   */
  proxy(request: NextRequest): Promise<NextResponse>;
  /** The verified session, or null. Never refreshes — the proxy does that. */
  getSession(): Promise<DenizSession | null>;
  /** Redirects to sign-in (and back to `returnTo`) when there is no session. */
  requireSession(returnTo?: string): Promise<DenizSession>;
  getAccessToken(): Promise<string | null>;
  /** `/auth/login?returnTo=…`, for links and buttons. */
  loginUrl(returnTo?: string): string;
  logoutUrl(returnTo?: string): string;
}

/**
 * Pass a function to read configuration lazily: `next build` imports route
 * modules without the runtime environment, and a missing secret should fail
 * the first sign-in, not the build.
 */
export function createDenizAuth(source: ConfigSource): DenizAuth {
  const resolved = lazyResolver(source);

  const route = (request: Request) => handle(resolved(), request);

  async function getSession(): Promise<DenizSession | null> {
    const r = resolved();
    const jar = await cookies();
    return sessionFromCookie(r, jar.get(r.sessionCookie)?.value);
  }

  return {
    GET: route,
    POST: route,

    async proxy(request) {
      const r = resolved();
      const outcome = await refreshFromCookie(
        r,
        request.cookies.get(r.sessionCookie)?.value,
      );
      if (outcome.kind === "none") return NextResponse.next();
      if (outcome.kind === "clear") {
        const response = NextResponse.next();
        response.cookies.set(r.sessionCookie, "", {
          httpOnly: true,
          secure: r.secure,
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
        return response;
      }
      const headers = new Headers(request.headers);
      headers.set(
        "cookie",
        withCookie(headers.get("cookie"), r.sessionCookie, outcome.cookie),
      );
      const response = NextResponse.next({ request: { headers } });
      response.cookies.set(r.sessionCookie, outcome.cookie, {
        httpOnly: true,
        secure: r.secure,
        sameSite: "lax",
        path: "/",
        maxAge: outcome.maxAge,
      });
      return response;
    },

    getSession,

    async requireSession(returnTo) {
      const session = await getSession();
      if (!session) redirect(loginPath(resolved(), returnTo));
      return session;
    },

    async getAccessToken() {
      return (await getSession())?.accessToken ?? null;
    },

    loginUrl(returnTo) {
      return loginPath(resolved(), returnTo);
    },

    logoutUrl(returnTo) {
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      return `${resolved().basePath}/logout${query}`;
    },
  };
}
