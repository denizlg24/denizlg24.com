import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getWorkHoursOverview } from "@/lib/work-hours";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await getWorkHoursOverview());
  } catch (error) {
    console.error("[hours] Overview failed", error);
    return NextResponse.json(
      { error: "Failed to load hours" },
      { status: 500 },
    );
  }
}
