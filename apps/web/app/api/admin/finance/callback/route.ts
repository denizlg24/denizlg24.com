import { type NextRequest, NextResponse } from "next/server";
import { completeFinanceLink } from "@/lib/finance/connection";
import { getAdminSession } from "@/lib/require-admin";

function redirect(request: NextRequest, status: string) {
  const url = new URL("/admin/dashboard/finance", request.url);
  url.searchParams.set("link", status);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  if (!(await getAdminSession(request))) {
    // The bank redirects the *browser* here, which carries a cookie session and
    // never the desktop app's Bearer token. Returning JSON would strand a
    // desktop-initiated link on a dead page while its FinanceLinkState expires,
    // so send the browser through login and back to finish the handshake.
    const login = new URL("/auth/login", request.url);
    login.searchParams.set("callbackUrl", request.nextUrl.toString());
    return NextResponse.redirect(login);
  }
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return redirect(request, "invalid");
  try {
    await completeFinanceLink(code, state);
    return redirect(request, "connected");
  } catch (error) {
    console.error("[finance] Link completion failed", error);
    return redirect(request, "failed");
  }
}
