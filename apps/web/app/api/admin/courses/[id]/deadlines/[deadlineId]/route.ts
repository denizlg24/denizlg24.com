import { courseDeadlinePatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { deleteCourseDeadline, updateCourseDeadline } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string; deadlineId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, deadlineId } = await params;
  const parsed = courseDeadlinePatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid deadline patch", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const course = await updateCourseDeadline(id, deadlineId, parsed.data);
  if (!course) {
    return NextResponse.json(
      { error: "Course or deadline not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ course }, { status: 200 });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, deadlineId } = await params;
  const course = await deleteCourseDeadline(id, deadlineId);
  if (!course) {
    return NextResponse.json(
      { error: "Course or deadline not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ course }, { status: 200 });
}
