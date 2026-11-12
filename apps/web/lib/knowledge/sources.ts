import {
  type ChunkDraft,
  chunkMarkdown,
  chunkPdf,
  chunkTranscript,
  type TranscriptSegment,
} from "@repo/utils/knowledge-chunk";
import mongoose from "mongoose";
import { downloadBytesFromStorage } from "@/lib/storage-api";
import { Note } from "@/models/Note";
import { StudyDocument } from "@/models/StudyDocument";
import { VoiceNote } from "@/models/VoiceNote";
import {
  deleteExtraction,
  loadExtraction,
  saveExtraction,
} from "./extraction-store";
import { extractPdfSource } from "./pdf-extract";

export type LoadedSource =
  | { status: "missing" }
  | { status: "failed"; error: string }
  | { status: "ready"; title: string; drafts: ChunkDraft[] };

async function loadNote(id: string): Promise<LoadedSource> {
  const note = await Note.findById(id)
    .select("title content")
    .lean<{ title: string; content: string }>()
    .exec();
  if (!note) return { status: "missing" };
  const drafts = chunkMarkdown({
    title: note.title,
    markdown: note.content ?? "",
  });
  return { status: "ready", title: note.title, drafts };
}

async function loadVoiceNote(id: string): Promise<LoadedSource> {
  const voiceNote = await VoiceNote.findById(id)
    .select("title recordedAt createdAt durationMs transcription")
    .lean<{
      title: string;
      recordedAt?: Date;
      createdAt: Date;
      durationMs?: number;
      transcription: {
        status: string;
        text?: string;
        segments?: Array<{
          text: string;
          startSecond: number;
          endSecond: number;
        }>;
      };
    }>()
    .exec();
  if (!voiceNote) return { status: "missing" };
  const { transcription } = voiceNote;
  if (transcription.status !== "transcribed") {
    return { status: "ready", title: voiceNote.title, drafts: [] };
  }
  const segments: TranscriptSegment[] = (transcription.segments ?? [])
    .filter((segment) => segment.text.trim())
    .map((segment) => ({
      startMs: Math.round(segment.startSecond * 1_000),
      endMs: Math.round(segment.endSecond * 1_000),
      text: segment.text,
    }));
  if (segments.length === 0 && transcription.text?.trim()) {
    segments.push({
      startMs: 0,
      endMs: voiceNote.durationMs ?? 0,
      text: transcription.text,
    });
  }
  const drafts = chunkTranscript({
    title: voiceNote.title,
    recordedAt: (voiceNote.recordedAt ?? voiceNote.createdAt).toISOString(),
    segments,
  });
  return { status: "ready", title: voiceNote.title, drafts };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadDocument(id: string): Promise<LoadedSource> {
  const document = await StudyDocument.findById(id).exec();
  if (!document) return { status: "missing" };

  let source =
    document.extraction === "ready" ? await loadExtraction(id) : null;
  if (document.extraction === "empty") {
    return { status: "ready", title: document.title, drafts: [] };
  }
  if (!source) {
    // Transient storage errors throw and retry; a PDF pdfjs cannot parse is
    // permanent and recorded on the document instead.
    const bytes = await downloadBytesFromStorage(document.storageKey);
    try {
      const extracted = await extractPdfSource(bytes, document.title);
      document.pageCount = extracted.source.pageCount;
      if (extracted.empty) {
        document.extraction = "empty";
        document.extractionError = undefined;
        await document.save();
        await deleteExtraction(id);
        return { status: "ready", title: document.title, drafts: [] };
      }
      await saveExtraction(id, extracted.source);
      source = extracted.source;
    } catch (error) {
      document.extraction = "failed";
      document.extractionError = errorMessage(error).slice(0, 2_000);
      await document.save();
      return { status: "failed", error: document.extractionError };
    }
  }

  const result = chunkPdf({ ...source, title: document.title });
  document.extraction = "ready";
  document.extractionError = undefined;
  document.layout = result.layout;
  document.pageCount = source.pageCount;
  await document.save();
  return { status: "ready", title: document.title, drafts: result.chunks };
}

export async function loadKnowledgeSource(
  kind: "note" | "document" | "voice-note",
  id: string,
): Promise<LoadedSource> {
  if (!mongoose.Types.ObjectId.isValid(id)) return { status: "missing" };
  if (kind === "note") return loadNote(id);
  if (kind === "voice-note") return loadVoiceNote(id);
  return loadDocument(id);
}
