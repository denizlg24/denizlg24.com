import { type NextRequest, NextResponse } from "next/server";
import { maybeSyncCourseSchedules } from "@/lib/course-lifecycle";
import {
  deleteCourse,
  getCourseById,
  getCourseDetail,
  updateCourse,
} from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const detail = await getCourseDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    return NextResponse.json({ detail }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch course:", error);
    return NextResponse.json(
      { error: "Failed to fetch course" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const body = await request.json();
    const course = await updateCourse(id, body);
    if (!course) {
      return NextResponse.json(
        { error: "Course not found or invalid input" },
        { status: 404 },
      );
    }
    await maybeSyncCourseSchedules();
    return NextResponse.json({ course }, { status: 200 });
  } catch (error) {
    console.error("Failed to update course:", error);
    return NextResponse.json(
      { error: "Failed to update course" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const existing = await getCourseById(id);
    if (!existing) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    const deleted = await deleteCourse(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete course" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete course:", error);
    return NextResponse.json(
      { error: "Failed to delete course" },
      { status: 500 },
    );
  }
}
