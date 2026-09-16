import type {
  IVoiceNote,
  IVoiceNoteSummary,
  VoiceNoteContext,
  VoiceNoteGroupRef,
  VoiceNoteMatch,
} from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";
import type { ILeanVoiceNote } from "@/models/VoiceNote";
import { describeContexts, recordedAtOf } from "./context";

const SUMMARY_WAVEFORM_SAMPLES = 48;
const TRANSCRIPT_PREVIEW_CHARS = 160;

export interface VoiceNoteRelations {
  context?: VoiceNoteContext;
  groups: VoiceNoteGroupRef[];
  linkedNotes: Array<{ _id: string; title: string }>;
}

const NO_RELATIONS: VoiceNoteRelations = { groups: [], linkedNotes: [] };

function iso(value: Date | string | undefined) {
  return value ? new Date(value).toISOString() : undefined;
}

function reduceWaveform(samples: number[]) {
  const rounded = (value: number) => Math.round(value * 100) / 100;
  if (samples.length <= SUMMARY_WAVEFORM_SAMPLES) return samples.map(rounded);
  const stride = samples.length / SUMMARY_WAVEFORM_SAMPLES;
  return Array.from({ length: SUMMARY_WAVEFORM_SAMPLES }, (_, index) => {
    const start = Math.floor(index * stride);
    const end = Math.max(start + 1, Math.floor((index + 1) * stride));
    return rounded(Math.max(...samples.slice(start, end)));
  });
}

function transcriptionState(voiceNote: ILeanVoiceNote) {
  const transcription = voiceNote.transcription;
  const progress = transcription?.progress;
  return {
    status: transcription?.status ?? "untranscribed",
    language: transcription?.language,
    model: transcription?.model,
    progress:
      progress?.total !== undefined && progress.completed !== undefined
        ? { completed: progress.completed, total: progress.total }
        : undefined,
    requestedAt: iso(transcription?.requestedAt),
    startedAt: iso(transcription?.startedAt),
    completedAt: iso(transcription?.completedAt),
    error: transcription?.error,
  };
}

export function serializeVoiceNoteSummary(
  voiceNote: ILeanVoiceNote,
  relations: VoiceNoteRelations = NO_RELATIONS,
  match?: VoiceNoteMatch,
): IVoiceNoteSummary {
  const preview = voiceNote.transcription?.text?.trim();
  return {
    _id: String(voiceNote._id),
    title: voiceNote.title,
    titleSource: voiceNote.titleSource ?? "manual",
    mimeType: voiceNote.mimeType,
    sizeBytes: voiceNote.sizeBytes,
    durationMs: voiceNote.durationMs,
    waveform: reduceWaveform(voiceNote.waveform ?? []),
    source: voiceNote.source,
    noteIds: (voiceNote.noteIds ?? []).map(String),
    tags: voiceNote.tags ?? [],
    groups: relations.groups,
    context: relations.context,
    contextSource: voiceNote.contextSource,
    recordedAt: recordedAtOf(voiceNote).toISOString(),
    transcription: transcriptionState(voiceNote),
    transcriptPreview: preview
      ? preview.slice(0, TRANSCRIPT_PREVIEW_CHARS)
      : undefined,
    match,
    createdAt: new Date(voiceNote.createdAt).toISOString(),
    updatedAt: new Date(voiceNote.updatedAt).toISOString(),
  };
}

export function serializeVoiceNote(
  voiceNote: ILeanVoiceNote,
  relations: VoiceNoteRelations = NO_RELATIONS,
): IVoiceNote {
  return {
    ...serializeVoiceNoteSummary(voiceNote, relations),
    filename: voiceNote.filename,
    waveform: voiceNote.waveform ?? [],
    linkedNotes: relations.linkedNotes,
    transcription: {
      ...transcriptionState(voiceNote),
      text: voiceNote.transcription?.text,
      segments: voiceNote.transcription?.segments?.map((segment) => ({
        text: segment.text,
        startSecond: segment.startSecond,
        endSecond: segment.endSecond,
      })),
    },
  };
}

/**
 * Context, linked note titles and the groups those notes sit in, for a page of
 * voice notes at once. Groups are read through the notes rather than stored,
 * so regrouping a note is reflected without touching its recordings.
 */
export async function loadVoiceNoteRelations(
  voiceNotes: ILeanVoiceNote[],
): Promise<Map<string, VoiceNoteRelations>> {
  await connectDB();
  const noteIds = [
    ...new Set(
      voiceNotes.flatMap((voiceNote) => (voiceNote.noteIds ?? []).map(String)),
    ),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id));

  const [contexts, notes] = await Promise.all([
    describeContexts(voiceNotes),
    noteIds.length
      ? Note.find({ _id: { $in: noteIds } })
          .select("title groupIds")
          .lean<Array<Pick<ILeanNote, "_id" | "title" | "groupIds">>>()
          .exec()
      : Promise.resolve([]),
  ]);
  const groupIds = [
    ...new Set(notes.flatMap((note) => (note.groupIds ?? []).map(String))),
  ];
  const groups = groupIds.length
    ? await NoteGroup.find({ _id: { $in: groupIds } })
        .select("name color")
        .lean<Array<Pick<ILeanNoteGroup, "_id" | "name" | "color">>>()
        .exec()
    : [];
  const noteById = new Map(notes.map((note) => [String(note._id), note]));
  const groupById = new Map(
    groups.map((group) => [
      String(group._id),
      { _id: String(group._id), name: group.name, color: group.color },
    ]),
  );

  const relations = new Map<string, VoiceNoteRelations>();
  for (const voiceNote of voiceNotes) {
    const linked = (voiceNote.noteIds ?? [])
      .map((id) => noteById.get(String(id)))
      .filter((note) => note !== undefined);
    const noteGroups = new Map<string, VoiceNoteGroupRef>();
    for (const note of linked) {
      for (const groupId of note.groupIds ?? []) {
        const group = groupById.get(String(groupId));
        if (group) noteGroups.set(group._id, group);
      }
    }
    relations.set(String(voiceNote._id), {
      context: contexts.get(String(voiceNote._id)),
      groups: [...noteGroups.values()],
      linkedNotes: linked.map((note) => ({
        _id: String(note._id),
        title: note.title,
      })),
    });
  }
  return relations;
}

/** One note with its relations, for routes that return a single voice note. */
export async function serializeVoiceNoteWithRelations(
  voiceNote: ILeanVoiceNote,
): Promise<IVoiceNote> {
  const relations = await loadVoiceNoteRelations([voiceNote]);
  return serializeVoiceNote(voiceNote, relations.get(String(voiceNote._id)));
}
