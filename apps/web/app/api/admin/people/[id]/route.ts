import { type NextRequest, NextResponse } from "next/server";
import { deletePerson, getPersonById, updatePerson } from "@/lib/people";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const person = await getPersonById(id);
  if (!person)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ person });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    const person = await updatePerson(id, body);
    if (!person)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ person });
  } catch (error) {
    console.error("Error updating person:", error);
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
    const deleted = await deletePerson(id);
    if (!deleted)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting person:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
