import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { getStorageObject } from "@/lib/storage-api";
import { type ILeanVoiceNote, VoiceNote } from "@/models/VoiceNote";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ voiceNoteId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { voiceNoteId } = await params;
  if (!mongoose.Types.ObjectId.isValid(voiceNoteId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }
  await connectDB();
  const voiceNote = await VoiceNote.findById(voiceNoteId)
    .select("storageKey mimeType")
    .lean<ILeanVoiceNote>()
    .exec();
  if (!voiceNote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const object = await getStorageObject(voiceNote.storageKey);
  if (!object) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": voiceNote.mimeType || object.contentType,
      ...(object.contentLength
        ? { "Content-Length": String(object.contentLength) }
        : {}),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(voiceNote.filename)}`,
    },
  });
}
