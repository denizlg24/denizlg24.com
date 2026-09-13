import { courseLinkMutationSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { addCourseLink, removeCourseLink } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const parsed = courseLinkMutationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid link", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const course = await addCourseLink(
    id,
    parsed.data.field,
    parsed.data.entityId,
  );
  if (!course) {
    return NextResponse.json(
      { error: "Course or entity not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ course }, { status: 200 });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const search = request.nextUrl.searchParams;
  const parsed = courseLinkMutationSchema.safeParse({
    field: search.get("field"),
    entityId: search.get("entityId"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid link", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const course = await removeCourseLink(
    id,
    parsed.data.field,
    parsed.data.entityId,
  );
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }
  return NextResponse.json({ course }, { status: 200 });
}
