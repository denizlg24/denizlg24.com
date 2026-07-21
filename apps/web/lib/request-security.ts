import type { NextRequest } from "next/server";

/** Reject browser cross-origin writes while retaining Bearer-token desktop access. */
export function isCrossOriginCookieRequest(request: NextRequest): boolean {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return false;
  const origin = request.headers.get("origin");
  return Boolean(origin && origin !== request.nextUrl.origin);
}
