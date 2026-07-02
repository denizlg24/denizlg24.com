import { type NextRequest, NextResponse } from "next/server";
import { getCourseOptions } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const options = await getCourseOptions();
    return NextResponse.json({ options }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch course options:", error);
    return NextResponse.json(
      { error: "Failed to fetch course options" },
      { status: 500 },
    );
  }
}
