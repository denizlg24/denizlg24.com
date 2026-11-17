import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { getAdminSession } from "@/lib/require-admin";
import { AiConnectionError } from "./errors";
import { oauthSessionHash } from "./oauth";

export async function authenticateAiConnectionRequest(
  request: NextRequest,
  mutation = false,
) {
  const session = await getAdminSession(request);
  if (!session)
    throw new AiConnectionError(
      "unauthorized",
      "Admin authentication required.",
      401,
    );
  const headers = new Headers(request.headers);
  if (session.via === "session") headers.delete("authorization");
  if (
    mutation &&
    (isCrossOriginCookieRequest(new NextRequest(request.url, { headers })) ||
      (session.via === "session" &&
        request.headers.get("sec-fetch-site") === "cross-site"))
  )
    throw new AiConnectionError(
      "origin",
      "Cross-origin request rejected.",
      403,
    );
  return session;
}

export async function authenticatedOAuthSession(
  request: NextRequest,
  authorize = false,
) {
  const session = await authenticateAiConnectionRequest(request, authorize);
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (session.via !== "session" || !cookie)
    throw new AiConnectionError(
      "browser_session",
      "A signed-in admin browser session is required.",
      403,
    );
  if (authorize) {
    // GET starts a credential mutation. Reject cross-site navigation, including
    // browsers without Fetch Metadata, by checking the initiating page's origin.
    const referer = request.headers.get("referer");
    const origin = request.headers.get("origin");
    const userNavigation =
      request.headers.get("sec-fetch-site") === "none" &&
      request.headers.get("sec-fetch-mode") === "navigate" &&
      request.headers.get("sec-fetch-dest") === "document";
    if (!origin && !referer && !userNavigation)
      throw new AiConnectionError(
        "origin",
        "Start Vercel authorization from this app.",
        403,
      );
    if (!origin && referer) {
      try {
        const headers = new Headers(request.headers);
        headers.set("origin", new URL(referer).origin);
        // Use the same edge-aware origin comparison as existing cookie writes.
        headers.delete("authorization");
        if (
          isCrossOriginCookieRequest(new NextRequest(request.url, { headers }))
        )
          throw new Error("origin");
      } catch {
        throw new AiConnectionError(
          "origin",
          "Cross-origin request rejected.",
          403,
        );
      }
    }
  }
  return oauthSessionHash(cookie, session.user.email);
}

export function aiConnectionErrorResponse(error: unknown) {
  const safe =
    error instanceof AiConnectionError
      ? error
      : new AiConnectionError(
          "internal",
          "AI connection operation failed.",
          500,
        );
  return NextResponse.json(
    { error: safe.message, code: safe.code },
    { status: safe.status, headers: { "Cache-Control": "no-store" } },
  );
}

export const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
