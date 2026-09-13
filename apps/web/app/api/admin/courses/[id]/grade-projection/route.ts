import { type NextRequest, NextResponse } from "next/server";
import { projectCourseGrade } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const raw = request.nextUrl.searchParams.get("targetAverage");
  let targetAverage: number | undefined;
  if (raw !== null) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return NextResponse.json(
        { error: "targetAverage must be a number between 0 and 100" },
        { status: 400 },
      );
    }
    targetAverage = value;
  }
  const projection = await projectCourseGrade(id, targetAverage);
  if (!projection) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }
  return NextResponse.json(projection, { status: 200 });
}
