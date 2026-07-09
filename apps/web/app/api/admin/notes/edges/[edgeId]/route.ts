import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { NoteEdge } from "@/models/NoteEdge";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ edgeId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { edgeId } = await params;
  if (!mongoose.Types.ObjectId.isValid(edgeId)) {
    return NextResponse.json({ error: "Invalid edge id" }, { status: 400 });
  }

  try {
    await connectDB();
    const result = await NoteEdge.deleteOne({ _id: edgeId });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting note edge:", error);
    return NextResponse.json(
      { error: "Failed to delete note edge" },
      { status: 500 },
    );
  }
}
