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
    const body: unknown = await request.json();
    const title =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).title === "string"
        ? ((body as Record<string, unknown>).title as string)
            .trim()
            .slice(0, 300)
        : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
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
        { $pull: { voiceNoteIds: voiceNote._id } },
      ).exec(),
      AgentMemoryJob.updateMany(
        {
          operation: "voice-transcription",
          "checkpoint.voiceNoteId": voiceNoteId,
          status: { $in: ["pending", "retry"] },
        },
        { $set: { status: "cancelled", completedAt: new Date() } },
      ).exec(),
    ]);
    await VoiceNote.deleteOne({ _id: voiceNote._id }).exec();
    await deleteFileFromStorage(voiceNote.storageKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete voice note", error);
    return NextResponse.json(
      { error: "Failed to delete voice note" },
      { status: 500 },
    );
  }
}
