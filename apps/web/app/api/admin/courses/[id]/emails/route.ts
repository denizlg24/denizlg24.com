import { courseEmailRelinkSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { getCourseById, getCourseRelatedEmails } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";
import { relinkCourseEmails } from "@/lib/triage";

function parseIntParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
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

    const search = request.nextUrl.searchParams;
    const page = await getCourseRelatedEmails(id, {
      page: parseIntParam(search.get("page")),
      pageSize: parseIntParam(search.get("pageSize")),
      category: search.get("category") ?? undefined,
      q: search.get("q") ?? undefined,
    });
    return NextResponse.json(page, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch course emails:", error);
    return NextResponse.json(
      { error: "Failed to fetch course emails" },
      { status: 500 },
    );
  }
}

/**
 * Moves mail off this course — `courseId: null` unlinks it, a course id moves
 * it there. Only rows currently matched to this course are touched.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = courseEmailRelinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const existing = await getCourseById(id);
    if (!existing) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    if (parsed.data.courseId === id) {
      return NextResponse.json(
        { error: "Already linked to this course" },
        { status: 400 },
      );
    }

    const result = await relinkCourseEmails({
      fromCourseId: id,
      triageIds: parsed.data.triageIds,
      toCourseId: parsed.data.courseId,
    });
    if (!result) {
      return NextResponse.json(
        { error: "Target course not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Failed to relink course emails:", error);
    return NextResponse.json(
      { error: "Failed to relink course emails" },
      { status: 500 },
    );
  }
}
