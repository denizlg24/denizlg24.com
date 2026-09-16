import type { VoiceNoteUpdateInput } from "@repo/schemas";
import mongoose from "mongoose";
import { redactAgentMemorySource } from "@/lib/agent-memory/source-deletion";
import { connectDB } from "@/lib/mongodb";
import { deleteFileFromStorage } from "@/lib/storage-api";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { Note } from "@/models/Note";
import { type ILeanVoiceNote, VoiceNote } from "@/models/VoiceNote";
import { applyDerivedContext, contextTargetExists } from "./context";

/**
 * Update and delete for voice notes, shared by the route and the agent tools.
 * The delete is a cascade across four stores, so a second implementation of it
 * would drift into leaving orphans.
 */

export class VoiceNoteContextNotFoundError extends Error {}

/** Lowercased, whitespace-collapsed and deduplicated, in the order given. */
export function normalizeVoiceNoteTags(tags: string[]) {
  return [
    ...new Set(
      tags
        .map((tag) => tag.replace(/\s+/g, " ").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export async function updateVoiceNote(
  voiceNoteId: string,
  input: VoiceNoteUpdateInput,
): Promise<ILeanVoiceNote | null> {
  if (!mongoose.Types.ObjectId.isValid(voiceNoteId)) return null;
  await connectDB();
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (input.title !== undefined) {
    set.title = input.title;
    set.titleSource = "manual";
  }
  if (input.tags !== undefined) set.tags = normalizeVoiceNoteTags(input.tags);
  if (input.context === null) {
    unset.context = "";
    set.contextSource = "manual";
  } else if (input.context && input.context !== "auto") {
    if (!(await contextTargetExists(input.context.kind, input.context.id))) {
      throw new VoiceNoteContextNotFoundError(
        `${input.context.kind} ${input.context.id} was not found`,
      );
    }
    set.context = {
      kind: input.context.kind,
      id: new mongoose.Types.ObjectId(input.context.id),
    };
    set.contextSource = "manual";
  } else if (input.context === "auto") {
    set.contextSource = "auto";
  }

  const updated = await VoiceNote.findByIdAndUpdate(
    voiceNoteId,
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
    { returnDocument: "after", runValidators: true },
  )
    .lean<ILeanVoiceNote>()
    .exec();
  if (!updated || input.context !== "auto") return updated;
  return applyDerivedContext(updated);
}

export async function deleteVoiceNote(voiceNoteId: string) {
  if (!mongoose.Types.ObjectId.isValid(voiceNoteId)) return false;
  await connectDB();
  const voiceNote = await VoiceNote.findById(voiceNoteId)
    .lean<ILeanVoiceNote>()
    .exec();
  if (!voiceNote) return false;

  await redactAgentMemorySource({
    entityType: "voice-note",
    entityId: voiceNoteId,
  });
  await Promise.all([
    Note.updateMany(
      { voiceNoteIds: voiceNote._id },
      {
        // Losing an attachment changes what the note is; it has to be
        // re-indexed for the same reason attaching one does.
        $pull: { voiceNoteIds: voiceNote._id },
        $set: { semanticStatus: "stale" },
      },
    ).exec(),
    AgentMemoryJob.updateMany(
      {
        operation: "voice-transcription",
        "checkpoint.voiceNoteId": voiceNoteId,
        // "leased" included to match redactAgentMemorySource: a job a worker
        // is holding still refers to audio that is about to stop existing.
        status: { $in: ["pending", "retry", "leased"] },
      },
      { $set: { status: "cancelled", completedAt: new Date() } },
    ).exec(),
  ]);

  // Storage first: an orphaned blob is invisible and cheap, whereas a row
  // pointing at a deleted object makes the note unplayable and undeletable.
  // A storage failure here is logged rather than fatal — the record is gone
  // either way, and reporting a failure would invite a retry that 404s.
  try {
    await deleteFileFromStorage(voiceNote.storageKey);
  } catch (error) {
    console.error("Failed to delete voice note audio", error);
  }
  await VoiceNote.deleteOne({ _id: voiceNote._id }).exec();
  return true;
}
