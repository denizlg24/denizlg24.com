import { courseDeadlineInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { addCourseDeadline } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const parsed = courseDeadlineInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid deadline", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await addCourseDeadline(id, parsed.data);
  if (!result) {
    return NextResponse.json(
      { error: "Course not found or invalid deadline" },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { course: result.course, deadlineId: result.deadlineId },
    { status: 201 },
  );
}
