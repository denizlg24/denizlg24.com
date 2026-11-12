import { type KnowledgeSourceKey, knowledgeSourceKey } from "@repo/schemas";
import type mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { Note } from "@/models/Note";
import { StudyDocument } from "@/models/StudyDocument";
import { VoiceNote } from "@/models/VoiceNote";

const TRANSCRIBED = { "transcription.status": "transcribed" } as const;

/** Every source the pipeline can index; archived notes included. */
export async function listAllSourceKeys(): Promise<KnowledgeSourceKey[]> {
  await connectDB();
  const [notes, voiceNotes, documents] = await Promise.all([
    Note.find()
      .select("_id")
      .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
      .exec(),
    VoiceNote.find(TRANSCRIBED)
      .select("_id")
      .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
      .exec(),
    StudyDocument.find()
      .select("_id")
      .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
      .exec(),
  ]);
  return [
    ...notes.map((row) => knowledgeSourceKey("note", String(row._id))),
    ...voiceNotes.map((row) =>
      knowledgeSourceKey("voice-note", String(row._id)),
    ),
    ...documents.map((row) => knowledgeSourceKey("document", String(row._id))),
  ];
}

export async function countSources(options: {
  includeArchived: boolean;
}): Promise<number> {
  await connectDB();
  const [notes, voiceNotes, documents] = await Promise.all([
    Note.countDocuments(
      options.includeArchived ? {} : { status: { $ne: "archived" } },
    ).exec(),
    VoiceNote.countDocuments(TRANSCRIBED).exec(),
    StudyDocument.countDocuments().exec(),
  ]);
  return notes + voiceNotes + documents;
}

export async function archivedNoteKeys(): Promise<KnowledgeSourceKey[]> {
  await connectDB();
  const rows = await Note.find({ status: "archived" })
    .select("_id")
    .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
    .exec();
  return rows.map((row) => knowledgeSourceKey("note", String(row._id)));
}
