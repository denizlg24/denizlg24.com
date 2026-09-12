import type { NextResponse } from "next/server";
import { cookieOptions } from "./admin-session";

export const DEFAULT_ADMIN_DESTINATION = "/admin/dashboard";

/**
 * Reduces a `callbackUrl` to a same-origin path. Anything absolute, protocol
 * relative, or pointing elsewhere is discarded — otherwise the parameter is an
 * open redirect.
 */
export function safeDestination(callbackUrl: string | null | undefined) {
  if (!callbackUrl) return DEFAULT_ADMIN_DESTINATION;
  try {
    const parsed = new URL(callbackUrl, "http://internal.invalid");
    if (parsed.origin !== "http://internal.invalid") {
      // Absolute URL: only keep it when it targets the configured site origin.
      const site = process.env.NEXT_PUBLIC_SITE_URL;
      if (!site || new URL(site).origin !== parsed.origin) {
        return DEFAULT_ADMIN_DESTINATION;
      }
    }
    const destination = `${parsed.pathname}${parsed.search}`;
    return destination.startsWith("/") && !destination.startsWith("//")
      ? destination
      : DEFAULT_ADMIN_DESTINATION;
  } catch {
    return DEFAULT_ADMIN_DESTINATION;
  }
}

/**
 * `cookies.delete` omits `Secure`, and a browser drops a `__Host-` cookie
 * instruction without it — the cookie would survive its own deletion.
 */
export function clearCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", cookieOptions(0));
}
