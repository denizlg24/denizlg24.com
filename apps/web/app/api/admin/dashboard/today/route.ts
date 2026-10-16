import { type NextRequest, NextResponse } from "next/server";
import { getDashboardToday } from "@/lib/dashboard-today";
import { requireAdmin } from "@/lib/require-admin";

/** The phone's Today tab and its widgets, in one bounded request. */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json(await getDashboardToday());
}
