import { type NextRequest, NextResponse } from "next/server";
import { deleteCourseAssignment, updateCourseAssignment } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assignmentId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, assignmentId } = await params;

  try {
    const body = await request.json();
    const assignment = await updateCourseAssignment(id, assignmentId, body);
    if (!assignment) {
      return NextResponse.json(
        { error: "Assignment not found or invalid input" },
        { status: 404 },
      );
    }
    return NextResponse.json({ assignment }, { status: 200 });
  } catch (error) {
    console.error("Failed to update course assignment:", error);
    return NextResponse.json(
      { error: "Failed to update course assignment" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assignmentId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, assignmentId } = await params;

  try {
    const deleted = await deleteCourseAssignment(id, assignmentId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete course assignment:", error);
    return NextResponse.json(
      { error: "Failed to delete course assignment" },
      { status: 500 },
    );
  }
}
