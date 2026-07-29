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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
