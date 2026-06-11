import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { classifyNoteWithSemanticLlm } from "@/lib/semantic-llm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { noteId } = await params;
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
    }

    const result = await classifyNoteWithSemanticLlm(noteId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error classifying semantic note:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
