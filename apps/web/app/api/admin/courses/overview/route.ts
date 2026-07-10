import { type NextRequest, NextResponse } from "next/server";
import { maybeSyncCourseSchedules } from "@/lib/course-lifecycle";
import { getSemesterOverview } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await maybeSyncCourseSchedules();
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
