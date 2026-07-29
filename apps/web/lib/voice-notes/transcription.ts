import "server-only";

import mongoose from "mongoose";
import { transcribeAudio } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { downloadBytesFromStorage } from "@/lib/storage-api";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import {
  type ILeanVoiceNote,
  VoiceNote,
  type VoiceNoteTranscriptionStatus,
} from "@/models/VoiceNote";
import { observeVoiceNoteTranscript } from "./memory";
import { generateVoiceNoteTitle } from "./title";

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;
const NIGHTLY_BATCH_SIZE = 100;
/**
 * Unattended transcription attempts before a note stops being picked up. A
 * recording that fails on a permanent fault — an unsupported codec, a blob the
 * model rejects — would otherwise be retried and billed every single night
 * forever. The explicit retry button ignores this and resets the count.
 */
const MAX_UNATTENDED_TRANSCRIPTION_ATTEMPTS = 3;

export function getVoiceTranscriptionModel() {
  return (
    process.env.VOICE_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL
  );
}

function voiceNoteIdFromJob(job: IAgentMemoryJob) {
  const value = job.checkpoint?.voiceNoteId;
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw new Error("Voice transcription job has an invalid voiceNoteId");
  }
  return value;
}

export async function enqueueVoiceNoteTranscription(
  voiceNoteId: string,
  options: { retryFailed?: boolean } = {},
) {
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(voiceNoteId)) {
    throw new Error("Invalid voice note ID");
  }

  const allowedStatuses: VoiceNoteTranscriptionStatus[] = options.retryFailed
    ? ["untranscribed", "failed", "transcribed"]
    : ["untranscribed", "failed"];
  const now = new Date();
  const voiceNote = await VoiceNote.findOneAndUpdate(
    {
      _id: voiceNoteId,
      "transcription.status": { $in: allowedStatuses },
    },
    {
      $set: {
        "transcription.status": "queued",
        "transcription.requestedAt": now,
        // An explicit retry is a person overriding the automatic give-up, so
        // it clears the counter that stopped the nightly sweep.
        ...(options.retryFailed ? { "transcription.failedAttempts": 0 } : {}),
      },
      $unset: {
        "transcription.error": "",
        "transcription.startedAt": "",
        "transcription.completedAt": "",
      },
      $inc: { "transcription.requestVersion": 1 },
    },
    { returnDocument: "after" },
  )
    .lean<ILeanVoiceNote>()
    .exec();

  if (!voiceNote) {
    const existing = await VoiceNote.findById(voiceNoteId)
      .lean<ILeanVoiceNote>()
      .exec();
    if (!existing) throw new Error("Voice note not found");
    return { queued: false, voiceNote: existing };
  }

  try {
    await AgentMemoryJob.create({
      idempotencyKey: `voice-transcription:${voiceNoteId}:${voiceNote.transcription.requestVersion}`,
      operation: "voice-transcription",
      evidenceIds: [],
      memoryIds: [],
      status: "pending",
      attempts: 0,
      availableAt: now,
      checkpoint: {
        voiceNoteId,
        requestVersion: voiceNote.transcription.requestVersion,
      },
    });
  } catch (error) {
    await VoiceNote.updateOne(
      {
        _id: voiceNoteId,
        "transcription.requestVersion": voiceNote.transcription.requestVersion,
        "transcription.status": "queued",
      },
      {
        $set: {
          "transcription.status": "failed",
          "transcription.error": "Failed to queue transcription",
        },
      },
    ).exec();
    throw error;
  }

  return { queued: true, voiceNote };
}

export async function enqueueNightlyVoiceTranscriptions() {
  await connectDB();
  const candidates = await VoiceNote.find({
    "transcription.status": { $in: ["untranscribed", "failed"] },
    // Both clauses have to tolerate a missing field: `$lt` is type-bracketed
    // and would skip every row written before the counter existed.
    $and: [
      {
        $or: [
          { "transcription.text": { $exists: false } },
          { "transcription.text": "" },
        ],
      },
      {
        $or: [
          { "transcription.failedAttempts": { $exists: false } },
          {
            "transcription.failedAttempts": {
              $lt: MAX_UNATTENDED_TRANSCRIPTION_ATTEMPTS,
            },
          },
        ],
      },
    ],
  })
    .select("_id")
    .sort({ createdAt: 1 })
    .limit(NIGHTLY_BATCH_SIZE)
    .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
    .exec();

  let queued = 0;
  for (const candidate of candidates) {
    const result = await enqueueVoiceNoteTranscription(
      candidate._id.toString(),
    );
    if (result.queued) queued += 1;
  }
  return { considered: candidates.length, queued };
}

/**
 * Heals notes marked `failed` that already hold a transcript — the shape left
 * behind when transcription succeeded and a step after it threw. Re-queueing
 * them would spend the audio budget a second time for text already on disk, so
 * the status is corrected and only the cheap steps re-run. Evidence is
 * idempotent, and the query goes empty once there is nothing left to heal.
 */
export async function repairTranscribedVoiceNotes() {
  await connectDB();
  const candidates = await VoiceNote.find({
    "transcription.status": "failed",
    "transcription.text": { $exists: true, $nin: [null, ""] },
  })
    .sort({ createdAt: 1 })
    .limit(NIGHTLY_BATCH_SIZE)
    .lean<ILeanVoiceNote[]>()
    .exec();

  let repaired = 0;
  const failures: Array<{ voiceNoteId: string; error: string }> = [];
  for (const candidate of candidates) {
    try {
      await VoiceNote.updateOne(
        { _id: candidate._id },
        {
          $set: {
            "transcription.status": "transcribed",
            "transcription.completedAt":
              candidate.transcription.completedAt ?? new Date(),
          },
          $unset: { "transcription.error": "" },
        },
      ).exec();
      candidate.transcription.status = "transcribed";
      const titled = await applyGeneratedTitle(candidate);
      await observeVoiceNoteTranscript(titled);
      repaired += 1;
    } catch (error) {
      failures.push({
        voiceNoteId: String(candidate._id),
        error: error instanceof Error ? error.message : "Repair failed",
      });
    }
  }
  return { considered: candidates.length, repaired, failures };
}

/** The single place voice audio is sent for transcription. */
export async function transcribeAudioFile(file: File, source: string) {
  if (file.size > MAX_TRANSCRIPTION_BYTES) {
    throw new Error("Audio exceeds the 25 MB transcription limit");
  }
  return transcribeAudio({
    purpose: "transcription",
    source,
    model: getVoiceTranscriptionModel(),
    file,
    signal: AbortSignal.timeout(270_000),
  });
}

/**
 * Transcribes the audio and persists the transcript. Returns null when another
 * worker already moved the note past this request version.
 */
async function transcribeVoiceNote(
  voiceNote: ILeanVoiceNote,
  requestVersion: number,
): Promise<ILeanVoiceNote | null> {
  const voiceNoteId = String(voiceNote._id);
  try {
    if (voiceNote.sizeBytes > MAX_TRANSCRIPTION_BYTES) {
      throw new Error("Voice note exceeds the 25 MB transcription limit");
    }
    const audio = await downloadBytesFromStorage(voiceNote.storageKey);
    const fileBytes = Uint8Array.from(audio).buffer;
    const {
      text,
      model,
      language,
      durationSeconds: durationInSeconds,
    } = await transcribeAudioFile(
      new File([fileBytes], voiceNote.filename, { type: voiceNote.mimeType }),
      "voice-note-transcription",
    );
    return await VoiceNote.findOneAndUpdate(
      {
        _id: voiceNoteId,
        "transcription.requestVersion": requestVersion,
      },
      {
        $set: {
          "transcription.status": "transcribed",
          "transcription.text": text,
          "transcription.language": language,
          "transcription.model": model,
          "transcription.completedAt": new Date(),
          ...(durationInSeconds && !voiceNote.durationMs
            ? { durationMs: Math.round(durationInSeconds * 1_000) }
            : {}),
        },
        $unset: {
          "transcription.error": "",
          "transcription.segments": "",
        },
      },
      { returnDocument: "after" },
    )
      .lean<ILeanVoiceNote>()
      .exec();
  } catch (error) {
    await VoiceNote.updateOne(
      {
        _id: voiceNoteId,
        "transcription.requestVersion": requestVersion,
      },
      {
        $set: {
          "transcription.status": "failed",
          "transcription.error":
            error instanceof Error ? error.message : "Transcription failed",
        },
        $inc: { "transcription.failedAttempts": 1 },
      },
    ).exec();
    throw error;
  }
}

/**
 * Rows written before `titleSource` existed carry no marker, so fall back to
 * recognising the shape both placeholder generators produce.
 */
function titleIsPlaceholder(voiceNote: ILeanVoiceNote): boolean {
  if (voiceNote.titleSource) return voiceNote.titleSource === "placeholder";
  return /^voice note\b/i.test(voiceNote.title ?? "");
}

/** Replaces an auto-generated title with one derived from the transcript. */
async function applyGeneratedTitle(
  voiceNote: ILeanVoiceNote,
): Promise<ILeanVoiceNote> {
  if (!titleIsPlaceholder(voiceNote)) return voiceNote;
  const transcript = voiceNote.transcription?.text?.trim();
  if (!transcript) return voiceNote;
  const title = await generateVoiceNoteTitle(transcript);
  if (!title) return voiceNote;
  const updated = await VoiceNote.findOneAndUpdate(
    { _id: voiceNote._id, titleSource: { $ne: "manual" } },
    { $set: { title, titleSource: "generated" } },
    { returnDocument: "after", runValidators: true },
  )
    .lean<ILeanVoiceNote>()
    .exec();
  return updated ?? voiceNote;
}

export async function processVoiceTranscriptionJob(job: IAgentMemoryJob) {
  const voiceNoteId = voiceNoteIdFromJob(job);
  const requestVersion =
    typeof job.checkpoint?.requestVersion === "number"
      ? job.checkpoint.requestVersion
      : undefined;
  if (requestVersion === undefined) {
    throw new Error("Voice transcription job has no requestVersion");
  }

  const claimed = await VoiceNote.findOneAndUpdate(
    {
      _id: voiceNoteId,
      "transcription.requestVersion": requestVersion,
      "transcription.status": { $in: ["queued", "transcribing", "failed"] },
    },
    {
      $set: {
        "transcription.status": "transcribing",
        "transcription.startedAt": new Date(),
      },
      $unset: { "transcription.error": "" },
    },
    { returnDocument: "after" },
  )
    .lean<ILeanVoiceNote>()
    .exec();

  // Nothing to claim means the audio is already transcribed at this version.
  // Titling and evidence still run: they are idempotent, and a retry exists
  // precisely because one of them failed after the transcript was persisted.
  const transcribed =
    claimed === null
      ? await VoiceNote.findOne({
          _id: voiceNoteId,
          "transcription.requestVersion": requestVersion,
          "transcription.status": "transcribed",
        })
          .lean<ILeanVoiceNote>()
          .exec()
      : await transcribeVoiceNote(claimed, requestVersion);
  if (!transcribed) return { skipped: true, voiceNoteId };

  const titled = await applyGeneratedTitle(transcribed);
  await observeVoiceNoteTranscript(titled);
  return {
    skipped: false,
    voiceNoteId,
    characters: titled.transcription.text?.length ?? 0,
    model: titled.transcription.model,
  };
}
