import { type NextRequest, NextResponse } from "next/server";
import { retryGoogleCalendarSyncFailures } from "@/lib/google-calendar-sync";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const result = await retryGoogleCalendarSyncFailures();
  return NextResponse.json(result, { status: 200 });
}
