import mongoose from "mongoose";
import { VoiceNote } from "@/models/VoiceNote";

export class InvalidVoiceNoteIdsError extends Error {}

export async function normalizeVoiceNoteIds(values: unknown[]) {
  const valid = values.filter(
    (value): value is string =>
      typeof value === "string" && mongoose.Types.ObjectId.isValid(value),
  );
  // Validity is judged before deduplication: comparing the deduplicated count
  // against the input length rejected a payload that merely listed the same
  // voice note twice, which is legal and simply means "attached once".
  if (valid.length !== values.length) {
    throw new InvalidVoiceNoteIdsError(
      "One or more voice note IDs are invalid",
    );
  }
  const ids = [...new Set(valid)];
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

/**
 * Rewrites the back-references on both sides of the note↔voice-note link.
 * Takes a session so the caller can commit it together with the note update
 * that motivated it: applying one without the other leaves the two collections
 * disagreeing about what is attached to what.
 */
export async function syncVoiceNoteLinks(
  noteId: string,
  voiceNoteIds: mongoose.Types.ObjectId[],
  session?: mongoose.ClientSession,
) {
  const noteObjectId = new mongoose.Types.ObjectId(noteId);
  const options = session ? { session } : {};
  await Promise.all([
    VoiceNote.updateMany(
      {
        noteIds: noteObjectId,
        _id: { $nin: voiceNoteIds },
      },
      { $pull: { noteIds: noteObjectId } },
      options,
    ).exec(),
    voiceNoteIds.length
      ? VoiceNote.updateMany(
          { _id: { $in: voiceNoteIds } },
          { $addToSet: { noteIds: noteObjectId } },
          options,
        ).exec()
      : Promise.resolve(),
  ]);
}
