import { type NextRequest, NextResponse } from "next/server";
import { getSemesterOverview } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const overview = await getSemesterOverview();
    return NextResponse.json({ overview }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch semester overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch semester overview" },
      { status: 500 },
    );
  }
}
