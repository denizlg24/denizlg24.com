import { voiceNoteTitleSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { redactAgentMemorySource } from "@/lib/agent-memory/source-deletion";
import { connectDB } from "@/lib/mongodb";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage } from "@/lib/storage-api";
import { serializeVoiceNote } from "@/lib/voice-notes/serialize";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { Note } from "@/models/Note";
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
    return NextResponse.json({ voiceNote: serializeVoiceNote(voiceNote) });
  } catch (error) {
    console.error("Failed to get voice note", error);
    return NextResponse.json(
      { error: "Failed to get voice note" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ voiceNoteId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { voiceNoteId } = await params;
    if (!mongoose.Types.ObjectId.isValid(voiceNoteId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }
    const parsed = voiceNoteTitleSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    const { title } = parsed.data;
    await connectDB();
    const voiceNote = await VoiceNote.findByIdAndUpdate(
      voiceNoteId,
      { $set: { title, titleSource: "manual" } },
      { returnDocument: "after", runValidators: true },
    )
      .lean<ILeanVoiceNote>()
      .exec();
    if (!voiceNote) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ voiceNote: serializeVoiceNote(voiceNote) });
  } catch (error) {
    console.error("Failed to update voice note", error);
    return NextResponse.json(
      { error: "Failed to update voice note" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ voiceNoteId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
    await redactAgentMemorySource({
      entityType: "voice-note",
      entityId: voiceNoteId,
    });
    await Promise.all([
      Note.updateMany(
        { voiceNoteIds: voiceNote._id },
        {
          $pull: { voiceNoteIds: voiceNote._id },
          // Losing an attachment changes what the note is; it has to be
          // re-indexed for the same reason attaching one does.
          $set: { semanticStatus: "stale" },
        },
      ).exec(),
      AgentMemoryJob.updateMany(
        {
          operation: "voice-transcription",
          "checkpoint.voiceNoteId": voiceNoteId,
          // "leased" included to match redactAgentMemorySource: a job a worker
          // is holding still refers to audio that is about to stop existing.
          status: { $in: ["pending", "retry", "leased"] },
        },
        { $set: { status: "cancelled", completedAt: new Date() } },
      ).exec(),
    ]);
    // Storage first: an orphaned blob is invisible and cheap, whereas a row
    // pointing at a deleted object makes the note unplayable and undeletable.
    // A storage failure here is logged rather than fatal — the record is gone
    // either way, and reporting a failure would invite a retry that 404s.
    try {
      await deleteFileFromStorage(voiceNote.storageKey);
    } catch (error) {
      console.error("Failed to delete voice note audio", error);
    }
    await VoiceNote.deleteOne({ _id: voiceNote._id }).exec();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete voice note", error);
    return NextResponse.json(
      { error: "Failed to delete voice note" },
      { status: 500 },
    );
  }
}
