/**
 * Gives voice notes written before recordedAt and context existed both fields.
 *
 * A recording's start is estimated as `createdAt − durationMs`: the upload
 * lands when recording stops, and paused time is not in the duration, so a
 * paused recording is dated a little late. Uploads keep their upload time and
 * are not linked. A context set or cleared by hand is never touched.
 *
 *   bun run voice-notes:backfill            # dry run, prints what would change
 *   bun run voice-notes:backfill --apply    # writes
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { deriveContext, describeContexts } from "@/lib/voice-notes/context";
import { type ILeanVoiceNote, VoiceNote } from "@/models/VoiceNote";

const apply = process.argv.includes("--apply");

function estimatedRecordedAt(voiceNote: ILeanVoiceNote) {
  const createdAt = new Date(voiceNote.createdAt).getTime();
  return new Date(
    voiceNote.source === "upload"
      ? createdAt
      : createdAt - (voiceNote.durationMs ?? 0),
  );
}

async function main() {
  await connectDB();
  const voiceNotes = await VoiceNote.find({
    $or: [
      { recordedAt: { $exists: false } },
      { contextSource: { $exists: false } },
    ],
  })
    .sort({ createdAt: 1 })
    .lean<ILeanVoiceNote[]>()
    .exec();

  let linked = 0;
  for (const voiceNote of voiceNotes) {
    const recordedAt = voiceNote.recordedAt
      ? new Date(voiceNote.recordedAt)
      : estimatedRecordedAt(voiceNote);
    const derive =
      voiceNote.source !== "upload" && voiceNote.contextSource !== "manual";
    const context = derive
      ? await deriveContext(recordedAt, voiceNote.durationMs)
      : null;
    if (context) linked += 1;

    const described = context
      ? (await describeContexts([{ ...voiceNote, recordedAt, context }])).get(
          String(voiceNote._id),
        )
      : undefined;
    console.log(
      JSON.stringify({
        id: String(voiceNote._id),
        title: voiceNote.title,
        recordedAt: recordedAt.toISOString(),
        context: described
          ? `${described.kind}: ${described.title}`
          : derive
            ? null
            : "unchanged",
      }),
    );

    if (!apply) continue;
    await VoiceNote.updateOne(
      { _id: voiceNote._id },
      {
        $set: {
          ...(voiceNote.recordedAt ? {} : { recordedAt }),
          ...(derive
            ? { contextSource: "auto", ...(context ? { context } : {}) }
            : {}),
        },
      },
    ).exec();
  }

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      considered: voiceNotes.length,
      linked,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
