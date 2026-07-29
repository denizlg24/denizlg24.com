import mongoose from "mongoose";
import { VoiceNote } from "@/models/VoiceNote";

export class InvalidVoiceNoteIdsError extends Error {}

export async function normalizeVoiceNoteIds(values: unknown[]) {
  const ids = [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && mongoose.Types.ObjectId.isValid(value),
      ),
    ),
  ];
  if (ids.length !== values.length) {
    throw new InvalidVoiceNoteIdsError(
      "One or more voice note IDs are invalid",
    );
  }
  const found = await VoiceNote.find({ _id: { $in: ids } })
    .select("_id")
    .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
    .exec();
  if (found.length !== ids.length) {
    throw new InvalidVoiceNoteIdsError(
      "One or more voice notes were not found",
    );
  }
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

export async function syncVoiceNoteLinks(
  noteId: string,
  voiceNoteIds: mongoose.Types.ObjectId[],
) {
  const noteObjectId = new mongoose.Types.ObjectId(noteId);
  await Promise.all([
    VoiceNote.updateMany(
      {
        noteIds: noteObjectId,
        _id: { $nin: voiceNoteIds },
      },
      { $pull: { noteIds: noteObjectId } },
    ).exec(),
    voiceNoteIds.length
      ? VoiceNote.updateMany(
          { _id: { $in: voiceNoteIds } },
          { $addToSet: { noteIds: noteObjectId } },
        ).exec()
      : Promise.resolve(),
  ]);
}
