import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";

export function proxy(request: NextRequest) {
  return auth.proxy(request);
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*", "/auth/session"],
};
