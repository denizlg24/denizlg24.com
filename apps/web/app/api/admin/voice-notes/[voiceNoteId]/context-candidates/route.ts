import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { listContextCandidates, recordedAtOf } from "@/lib/voice-notes/context";
import { type ILeanVoiceNote, VoiceNote } from "@/models/VoiceNote";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ voiceNoteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { voiceNoteId } = await params;
    if (!mongoose.Types.ObjectId.isValid(voiceNoteId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }
    await connectDB();
    const voiceNote = await VoiceNote.findById(voiceNoteId)
      .lean<ILeanVoiceNote>()
      .exec();
    if (!voiceNote) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      await listContextCandidates(
        recordedAtOf(voiceNote),
        voiceNote.durationMs,
      ),
    );
  } catch (error) {
    console.error("Failed to list voice note context candidates", error);
    return NextResponse.json(
      { error: "Failed to list context candidates" },
      { status: 500 },
    );
  }
}
