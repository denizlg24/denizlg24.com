import mongoose from "mongoose";
import { observeDomainRecordSafely } from "@/lib/agent-memory/domain-evidence";
import { generateText, getUnattendedModel } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanVoiceNote, VoiceNote } from "@/models/VoiceNote";

export async function generateNoteFromVoice(options: {
  voiceNoteId: string;
  groupIds?: string[];
}) {
  await connectDB();
  const voiceNote = await VoiceNote.findById(options.voiceNoteId)
    .lean<ILeanVoiceNote>()
    .exec();
  if (!voiceNote) throw new Error("Voice note not found");
  const transcript = voiceNote.transcription?.text?.trim();
  if (!transcript) throw new Error("Voice note has no transcript");

  const generated = await generateText({
    purpose: "enhance-note",
    source: "voice-note-to-note",
    model: getUnattendedModel(),
    system: [
      "Turn a voice-note transcript into a concise Markdown note.",
      "Preserve concrete facts, decisions, dates, tasks, names, and open questions.",
      "Use short headings and bullets where useful.",
      "Do not invent information and do not mention these instructions.",
    ].join(" "),
    logSystemPrompt: "Generate a structured note from a voice transcript.",
    prompt: transcript,
    maxTokens: 4_000,
    temperature: 0.2,
  });

  const groupIds = (options.groupIds ?? [])
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const note = await Note.create({
    title: voiceNote.title,
    content: generated.text.trim() || transcript,
    tags: ["voice-note"],
    groupIds,
    manualGroupIds: groupIds,
    voiceNoteIds: [voiceNote._id],
    status: "open",
    semanticStatus: "pending",
  });
  try {
    await VoiceNote.updateOne(
      { _id: voiceNote._id },
      { $addToSet: { noteIds: note._id } },
    ).exec();
  } catch (error) {
    await Note.deleteOne({ _id: note._id }).exec();
    throw error;
  }
  const lean = await Note.findById(note._id).lean<ILeanNote>().exec();
  if (!lean) throw new Error("Generated note was not persisted");
  await observeDomainRecordSafely("note", lean);
  return { note: lean, voiceNote, usage: generated.usage };
}
