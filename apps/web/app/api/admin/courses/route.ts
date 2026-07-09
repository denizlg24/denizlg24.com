import { type NextRequest, NextResponse } from "next/server";
import {
  maybeSyncCourseSchedules,
  syncCourseSchedules,
} from "@/lib/course-lifecycle";
import { createCourse, getCourses } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await maybeSyncCourseSchedules();
    const courses = await getCourses();
    return NextResponse.json({ courses }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch courses:", error);
    return NextResponse.json(
      { error: "Failed to fetch courses" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const course = await createCourse(body);

    if (!course) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    await syncCourseSchedules().catch((error) => {
      console.error("Course schedule sync failed:", error);
    });
    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    console.error("Failed to create course:", error);
    return NextResponse.json(
      { error: "Failed to create course" },
      { status: 500 },
    );
  }
}
