import type { ILeanVoiceNote } from "@/models/VoiceNote";

function iso(value: Date | string | undefined) {
  return value ? new Date(value).toISOString() : undefined;
}

export function serializeVoiceNote(voiceNote: ILeanVoiceNote) {
  return {
    _id: String(voiceNote._id),
    title: voiceNote.title,
    filename: voiceNote.filename,
    mimeType: voiceNote.mimeType,
    sizeBytes: voiceNote.sizeBytes,
    durationMs: voiceNote.durationMs,
    waveform: voiceNote.waveform ?? [],
    source: voiceNote.source,
    noteIds: (voiceNote.noteIds ?? []).map(String),
    transcription: {
      status: voiceNote.transcription?.status ?? "untranscribed",
      text: voiceNote.transcription?.text,
      language: voiceNote.transcription?.language,
      model: voiceNote.transcription?.model,
      segments: voiceNote.transcription?.segments,
      requestedAt: iso(voiceNote.transcription?.requestedAt),
      startedAt: iso(voiceNote.transcription?.startedAt),
      completedAt: iso(voiceNote.transcription?.completedAt),
      error: voiceNote.transcription?.error,
    },
    createdAt: new Date(voiceNote.createdAt).toISOString(),
    updatedAt: new Date(voiceNote.updatedAt).toISOString(),
  };
}
