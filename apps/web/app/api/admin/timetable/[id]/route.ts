import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import {
  deleteTimetableEntry,
  getTimetableEntryById,
  updateTimetableEntry,
} from "@/lib/timetable";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const entry = await getTimetableEntryById(id);
    if (!entry) {
      return NextResponse.json(
        { error: "Timetable entry not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ entry }, { status: 200 });
  } catch (error) {
    console.error("Error fetching timetable entry:", error);
    return NextResponse.json(
      { error: "Failed to fetch timetable entry" },
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
  const body = await request.json();

  const updated = await updateTimetableEntry(id, body);
  if (!updated) {
    return NextResponse.json(
      { error: "Failed to update timetable entry" },
      { status: 500 },
    );
  }
  return NextResponse.json({ entry: updated }, { status: 200 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  const deleted = await deleteTimetableEntry(id);
  if (!deleted) {
    return NextResponse.json(
      { error: "Failed to delete timetable entry" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
