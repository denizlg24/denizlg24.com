import { voiceNoteTitleSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { deleteVoiceNote, renameVoiceNote } from "@/lib/voice-notes/mutations";
import { serializeVoiceNote } from "@/lib/voice-notes/serialize";
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
    const voiceNote = await renameVoiceNote(voiceNoteId, parsed.data.title);
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
    const deleted = await deleteVoiceNote(voiceNoteId);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete voice note", error);
    return NextResponse.json(
      { error: "Failed to delete voice note" },
      { status: 500 },
    );
  }
}
