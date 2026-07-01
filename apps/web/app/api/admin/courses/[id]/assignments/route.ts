import { type NextRequest, NextResponse } from "next/server";
import {
  createCourseAssignment,
  getCourseById,
  getCourseDetail,
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
    return NextResponse.json(
      { assignments: detail.assignments },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to fetch course assignments:", error);
    return NextResponse.json(
      { error: "Failed to fetch course assignments" },
      { status: 500 },
    );
  }
}

export async function POST(
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

    const body = await request.json();
    const assignment = await createCourseAssignment(id, body);
    if (!assignment) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    console.error("Failed to create course assignment:", error);
    return NextResponse.json(
      { error: "Failed to create course assignment" },
      { status: 500 },
    );
  }
}
