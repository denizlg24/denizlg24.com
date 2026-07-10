import { type NextRequest, NextResponse } from "next/server";
import { deletePersonGroup, updatePersonGroup } from "@/lib/people";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    const group = await updatePersonGroup(id, body);
    if (!group)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ group });
  } catch (error) {
    console.error("Error updating person group:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const deleted = await deletePersonGroup(id);
    if (!deleted)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting person group:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
