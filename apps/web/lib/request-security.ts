import type { NextRequest } from "next/server";

function forwardedRequestOrigin(request: NextRequest): string | null {
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  )
    ?.trim()
    .toLowerCase();
  const protocol = request.headers
    .get("x-forwarded-proto")
    ?.trim()
    .toLowerCase();

  // Forge's Caddy edge replaces these headers before proxying. Refuse lists
  // and non-origin syntax rather than letting URL parsing reinterpret them as
  // credentials, a path, or a second proxy hop.
  if (
    !host ||
    !protocol ||
    (protocol !== "http" && protocol !== "https") ||
    !/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::[0-9]+)?$/i.test(host)
  ) {
    return null;
  }

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

/** Reject browser cross-origin writes while retaining Bearer-token desktop access. */
export function isCrossOriginCookieRequest(request: NextRequest): boolean {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return true;
  }

  if (normalizedOrigin === request.nextUrl.origin) return false;

  // The browser sees the public HTTPS origin, while Next.js sees the internal
  // HTTP upstream URL behind Forge. Compare with the edge-preserved origin so
  // legitimate cookie-authenticated writes are not rejected as cross-origin.
  return normalizedOrigin !== forwardedRequestOrigin(request);
}
