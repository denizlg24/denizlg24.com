import "server-only";

import mongoose from "mongoose";
import OpenAI from "openai";
import { connectDB } from "@/lib/mongodb";
import { downloadBytesFromStorage } from "@/lib/storage-api";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import {
  type ILeanVoiceNote,
  VoiceNote,
  type VoiceNoteTranscriptionStatus,
} from "@/models/VoiceNote";
import { observeVoiceNoteTranscript } from "./memory";

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;
const NIGHTLY_BATCH_SIZE = 100;

export function getVoiceTranscriptionModel() {
  return (
    process.env.VOICE_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL
  );
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for voice transcription");
  }
  return new OpenAI({ apiKey });
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

export async function processVoiceTranscriptionJob(job: IAgentMemoryJob) {
  const voiceNoteId = voiceNoteIdFromJob(job);
  const requestVersion =
    typeof job.checkpoint?.requestVersion === "number"
      ? job.checkpoint.requestVersion
      : undefined;
  if (requestVersion === undefined) {
    throw new Error("Voice transcription job has no requestVersion");
  }

  const voiceNote = await VoiceNote.findOneAndUpdate(
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
  if (!voiceNote) return { skipped: true, voiceNoteId };
  if (voiceNote.sizeBytes > MAX_TRANSCRIPTION_BYTES) {
    throw new Error("Voice note exceeds the 25 MB transcription limit");
  }

  try {
    const audio = await downloadBytesFromStorage(voiceNote.storageKey);
    if (audio.byteLength > MAX_TRANSCRIPTION_BYTES) {
      throw new Error("Voice note exceeds the 25 MB transcription limit");
    }
    const model = getVoiceTranscriptionModel();
    const fileBytes = Uint8Array.from(audio).buffer;
    const result = await getOpenAIClient().audio.transcriptions.create(
      {
        file: new File([fileBytes], voiceNote.filename, {
          type: voiceNote.mimeType,
        }),
        model,
        response_format: "json",
      },
      { signal: AbortSignal.timeout(270_000) },
    );
    const durationInSeconds =
      result.usage?.type === "duration" ? result.usage.seconds : undefined;
    const completed = await VoiceNote.findOneAndUpdate(
      {
        _id: voiceNoteId,
        "transcription.requestVersion": requestVersion,
      },
      {
        $set: {
          "transcription.status": "transcribed",
          "transcription.text": result.text.trim(),
          "transcription.language": result.languages?.[0]?.code,
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
    if (!completed) return { skipped: true, voiceNoteId };
    await observeVoiceNoteTranscript(completed);
    return {
      skipped: false,
      voiceNoteId,
      characters: completed.transcription.text?.length ?? 0,
      model,
    };
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
      },
    ).exec();
    throw error;
  }
}
