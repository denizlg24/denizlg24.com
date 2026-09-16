import { VOICE_NOTE_MAX_BYTES } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage, uploadFileToStorage } from "@/lib/storage-api";
import { isSupportedAudio } from "@/lib/voice-notes/audio";
import { applyDerivedContext } from "@/lib/voice-notes/context";
import {
  listVoiceNotes,
  parseVoiceNoteListQuery,
} from "@/lib/voice-notes/query";
import { serializeVoiceNoteWithRelations } from "@/lib/voice-notes/serialize";
import { enqueueVoiceNoteTranscription } from "@/lib/voice-notes/transcription";
import { Note } from "@/models/Note";
import { type ILeanVoiceNote, VoiceNote } from "@/models/VoiceNote";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_WAVEFORM_SAMPLES = 240;

function parseWaveform(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_WAVEFORM_SAMPLES)
      .filter((sample): sample is number => Number.isFinite(sample))
      .map((sample) => Math.min(1, Math.max(0, sample)));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = parseVoiceNoteListQuery(request.nextUrl.searchParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await listVoiceNotes(parsed.data));
  } catch (error) {
    console.error("Failed to list voice notes", error);
    return NextResponse.json(
      { error: "Failed to list voice notes" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;

  let storageKey: string | undefined;
  let createdVoiceNoteId: mongoose.Types.ObjectId | undefined;
  let linkedNoteId: mongoose.Types.ObjectId | undefined;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > VOICE_NOTE_MAX_BYTES + 1024 * 1024) {
      return NextResponse.json(
        { error: "Recording exceeds the 256 MB limit" },
        { status: 413 },
      );
    }
    const data = await request.formData();
    const entry = data.get("file");
    if (!(entry instanceof File)) {
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });
    }
    if (entry.size === 0 || entry.size > VOICE_NOTE_MAX_BYTES) {
      return NextResponse.json(
        { error: "Recording must be between 1 byte and 256 MB" },
        { status: 413 },
      );
    }
    if (!isSupportedAudio(entry)) {
      return NextResponse.json(
        { error: "Unsupported audio format" },
        { status: 415 },
      );
    }

    const rawTitle = data.get("title");
    const hasTitle = typeof rawTitle === "string" && rawTitle.trim().length > 0;
    const title = hasTitle
      ? rawTitle.trim().slice(0, 300)
      : `Voice note ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    // A caller that auto-derived the title says so, and transcription replaces
    // it with a real one. Anything else is treated as the owner's own wording.
    const titleSource =
      data.get("titleSource") === "placeholder" || !hasTitle
        ? "placeholder"
        : "manual";
    // Number(null) is 0, so an absent field used to record a zero-length
    // recording rather than leaving the duration unknown.
    const rawDuration = data.get("durationMs");
    const parsedDuration =
      typeof rawDuration === "string" && rawDuration.trim()
        ? Number(rawDuration)
        : Number.NaN;
    const durationMs =
      Number.isFinite(parsedDuration) && parsedDuration >= 0
        ? Math.round(parsedDuration)
        : undefined;
    const source =
      data.get("source") === "agent"
        ? "agent"
        : data.get("source") === "upload"
          ? "upload"
          : "recording";
    const rawRecordedAt = data.get("recordedAt");
    const parsedRecordedAt =
      typeof rawRecordedAt === "string" && rawRecordedAt.trim()
        ? new Date(rawRecordedAt)
        : undefined;
    if (parsedRecordedAt && Number.isNaN(parsedRecordedAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid recordedAt" },
        { status: 400 },
      );
    }
    // A recording that did not say when it started ended about now.
    const recordedAt =
      parsedRecordedAt ??
      new Date(Date.now() - (source === "upload" ? 0 : (durationMs ?? 0)));
    const noteId = data.get("noteId");
    // Silently dropping an unusable noteId stored the recording detached from
    // the note the caller meant to attach it to, with nothing to indicate it.
    if (
      noteId !== null &&
      (typeof noteId !== "string" || !mongoose.Types.ObjectId.isValid(noteId))
    ) {
      return NextResponse.json({ error: "Invalid noteId" }, { status: 400 });
    }
    const noteIds =
      typeof noteId === "string" ? [new mongoose.Types.ObjectId(noteId)] : [];

    const uploaded = await uploadFileToStorage(entry, "voice");
    storageKey = uploaded.id;
    await connectDB();
    const created = await VoiceNote.create({
      title,
      titleSource,
      storageKey: uploaded.id,
      filename: entry.name,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      durationMs,
      waveform: parseWaveform(data.get("waveform")),
      source,
      noteIds,
      recordedAt,
      transcription: { status: "untranscribed", requestVersion: 0 },
    });
    createdVoiceNoteId = created._id;
    if (noteIds[0]) {
      const linked = await Note.updateOne(
        { _id: noteIds[0] },
        {
          $addToSet: { voiceNoteIds: created._id },
          $set: { semanticStatus: "stale" },
        },
      ).exec();
      if (linked.matchedCount === 0) {
        throw new Error("Attached note was not found");
      }
      linkedNoteId = noteIds[0];
    }
    // Upload time says nothing about what an uploaded file was a recording of.
    if (source !== "upload" || parsedRecordedAt) {
      try {
        const stored = await VoiceNote.findById(created._id)
          .lean<ILeanVoiceNote>()
          .exec();
        if (stored) await applyDerivedContext(stored);
      } catch (error) {
        console.error("Failed to link voice note context", error);
      }
    }
    if (data.get("transcribe") === "true") {
      // The recording is already durable at this point. A queueing failure is
      // a transcription problem, not an upload one — rolling back here would
      // delete audio the caller was told nothing about and cannot re-record.
      // `enqueueVoiceNoteTranscription` marks the note failed on its way out,
      // and both the nightly sweep and the retry button can pick it up again.
      try {
        const queued = await enqueueVoiceNoteTranscription(
          created._id.toString(),
        );
        return NextResponse.json(
          {
            voiceNote: await serializeVoiceNoteWithRelations(queued.voiceNote),
          },
          { status: 201 },
        );
      } catch (error) {
        console.error(
          "Failed to queue transcription for new voice note",
          error,
        );
        const stored = await VoiceNote.findById(created._id)
          .lean<ILeanVoiceNote>()
          .exec();
        if (stored) {
          return NextResponse.json(
            { voiceNote: await serializeVoiceNoteWithRelations(stored) },
            { status: 201 },
          );
        }
        throw error;
      }
    }
    const lean = await VoiceNote.findById(created._id)
      .lean<ILeanVoiceNote>()
      .exec();
    if (!lean) throw new Error("Voice note was not persisted");
    return NextResponse.json(
      { voiceNote: await serializeVoiceNoteWithRelations(lean) },
      { status: 201 },
    );
  } catch (error) {
    await Promise.allSettled([
      ...(storageKey ? [deleteFileFromStorage(storageKey)] : []),
      ...(createdVoiceNoteId
        ? [VoiceNote.deleteOne({ _id: createdVoiceNoteId }).exec()]
        : []),
      ...(linkedNoteId && createdVoiceNoteId
        ? [
            Note.updateOne(
              { _id: linkedNoteId },
              { $pull: { voiceNoteIds: createdVoiceNoteId } },
            ).exec(),
          ]
        : []),
    ]);
    console.error("Failed to store voice note", error);
    return NextResponse.json(
      { error: "Failed to store voice note" },
      { status: 500 },
    );
  }
}
