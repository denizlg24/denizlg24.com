import crypto from "node:crypto";
import {
  bearerToken,
  type CloudAccessToken,
  isSuperuserToken,
  looksLikeJwt,
} from "@repo/cloud-auth-client/resource";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import ApiKey from "@/models/ApiKey";
import {
  ADMIN_SESSION_COOKIE,
  openSession,
  verifySiteAccessToken,
} from "./admin-session";
import { connectDB } from "./mongodb";

export interface AdminSession {
  user: {
    /** Stable per principal; rate limits key on it. */
    email: string;
    role: "admin";
  };
  via: "api-key" | "oauth" | "session";
}

function fromAccessToken(
  token: CloudAccessToken,
  via: AdminSession["via"],
): AdminSession | null {
  if (!isSuperuserToken(token)) return null;
  return {
    user: {
      email: token.machine ? `client:${token.clientId}` : token.subject,
      role: "admin",
    },
    via,
  };
}

async function apiKeyExists(token: string): Promise<boolean> {
  await connectDB();
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return (await ApiKey.findOne({ key: hash }).lean()) !== null;
}

async function fromBearer(request?: NextRequest): Promise<AdminSession | null> {
  const token = bearerToken(request?.headers.get("authorization"));
  if (!token) return null;
  // The MCP server calls in with access tokens our authorization server issued
  // for this site; the desktop app with an opaque API key.
  if (looksLikeJwt(token)) {
    const verified = await verifySiteAccessToken(token);
    return verified ? fromAccessToken(verified, "oauth") : null;
  }
  return (await apiKeyExists(token))
    ? { user: { email: "admin-token", role: "admin" }, via: "api-key" }
    : null;
}

async function fromSessionCookie(
  request?: NextRequest,
): Promise<AdminSession | null> {
  const value = request
    ? request.cookies.get(ADMIN_SESSION_COOKIE)?.value
    : (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const session = await openSession(value);
  if (!session) return null;
  // proxy.ts refreshes an expiring token before the request gets here, so an
  // expired one means the refresh failed and the grant is gone.
  const verified = await verifySiteAccessToken(session.at);
  return verified ? fromAccessToken(verified, "session") : null;
}

export async function getAdminSession(
  request?: NextRequest,
): Promise<AdminSession | null> {
  return (await fromBearer(request)) ?? (await fromSessionCookie(request));
}

export async function requireAdmin(request?: NextRequest) {
  if (!(await getAdminSession(request))) {
    forbidden();
  }
  return null;
}

/**
 * Gate for a page, including the one installed to the iPhone Home Screen:
 * that app keeps its own cookie jar, so its first launch has no session, and a
 * 403 there would strand it on the public site. Every session this site holds
 * is an admin one — the authorization server refuses anyone else — so there is
 * no signed-in-but-forbidden case to loop on.
 */
export async function requireAdminPage(callbackPath: string) {
  const session = await getAdminSession();
  if (session) return session;
  redirect(`/auth/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
}
