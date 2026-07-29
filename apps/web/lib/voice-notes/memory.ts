import {
  buildEvidenceInput,
  observeEvidence,
} from "@/lib/agent-memory/evidence";
import type { ILeanVoiceNote } from "@/models/VoiceNote";

const CHUNK_CHARS = 5_000;
const CHUNK_OVERLAP = 250;
const MAX_CHUNKS = 40;

function transcriptChunks(text: string) {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(cursor + CHUNK_CHARS, normalized.length);
    if (end < normalized.length) {
      const paragraph = normalized.lastIndexOf("\n\n", end);
      const sentence = normalized.lastIndexOf(". ", end);
      const boundary = Math.max(paragraph, sentence);
      if (boundary > cursor + CHUNK_CHARS / 2) end = boundary + 1;
    }
    chunks.push(normalized.slice(cursor, end).trim());
    if (end >= normalized.length) break;
    cursor = Math.max(cursor + 1, end - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

export async function observeVoiceNoteTranscript(
  voiceNote: ILeanVoiceNote,
): Promise<void> {
  const transcript = voiceNote.transcription?.text?.trim();
  if (!transcript) return;

  const voiceNoteId = String(voiceNote._id);
  const completedAt =
    voiceNote.transcription.completedAt ?? voiceNote.updatedAt ?? new Date();
  const chunks = transcriptChunks(transcript);
  for (const [index, chunk] of chunks.entries()) {
    const content = {
      title: voiceNote.title,
      transcript: chunk,
      chunk: index + 1,
      chunks: chunks.length,
      language: voiceNote.transcription.language,
      noteIds: (voiceNote.noteIds ?? []).map(String),
      recordedAt: voiceNote.createdAt,
      durationMs: voiceNote.durationMs,
    };
    await observeEvidence({
      memoryMode: "enabled",
      evidence: buildEvidenceInput({
        idempotencyKey: `voice-note:${voiceNoteId}:${voiceNote.transcription.requestVersion}:${index}`,
        sourceType: "attachment",
        sourceRef: {
          entityType: "voice-note",
          entityId: voiceNoteId,
          revision: String(voiceNote.transcription.requestVersion),
        },
        sourceRevision: String(voiceNote.transcription.requestVersion),
        content,
        snapshot: JSON.stringify(content),
        occurredAt: completedAt,
        actor: "user",
        trust: "high",
        sensitivity: "sensitive",
        provenance: {
          adapter: "voice-note-transcript-v1",
          voiceNoteId,
          chunkIndex: index,
        },
      }),
    });
  }
}
