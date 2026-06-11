import { type NextRequest, NextResponse } from "next/server";
import {
  deleteJournal,
  getJournalById,
  updateJournalContent,
} from "@/lib/journal";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const journal = await getJournalById(id);
  if (!journal) {
    return NextResponse.json({ error: "Journal not found" }, { status: 404 });
  }

  return NextResponse.json({ journal }, { status: 200 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();

  if (typeof body.content !== "string") {
    return NextResponse.json(
      { error: "content must be a string" },
      { status: 400 },
    );
  }

  const journal = await updateJournalContent(id, body.content);
  if (!journal) {
    return NextResponse.json(
      { error: "Failed to update journal" },
      { status: 500 },
    );
  }

  return NextResponse.json({ journal }, { status: 200 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const deleted = await deleteJournal(id);
  if (!deleted) {
    return NextResponse.json(
      { error: "Failed to delete journal" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
