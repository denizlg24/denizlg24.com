import { type NextRequest, NextResponse } from "next/server";
import { getPersonById, getPersonEdges, replaceRelations } from "@/lib/people";
import { requireAdmin } from "@/lib/require-admin";

/** Replaces every relation of a person; an empty array removes them all. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    if (!Array.isArray(body.relations)) {
      return NextResponse.json(
        { error: "relations must be an array" },
        { status: 400 },
      );
    }
    const person = await getPersonById(id);
    if (!person)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await replaceRelations(id, body.relations);
    const edges = await getPersonEdges(id);
    return NextResponse.json({ person, edges });
  } catch (error) {
    console.error("Error replacing person relations:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
