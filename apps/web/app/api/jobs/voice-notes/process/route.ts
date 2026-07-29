import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
  sweepOrphanedLeases,
} from "@/lib/agent-memory/jobs";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";
import { processVoiceTranscriptionJob } from "@/lib/voice-notes/transcription";

export const maxDuration = 300;

async function processNext(request: Request) {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await sweepOrphanedLeases();
  const workerId = `voice-note-route:${randomUUID()}`;
  const job = await leaseNextMemoryJob({
    workerId,
    operations: ["voice-transcription"],
  });
  if (!job) {
    return NextResponse.json({ processed: false });
  }
  try {
    const result = await processVoiceTranscriptionJob(job);
    await completeMemoryJob(job._id.toString(), workerId);
    return NextResponse.json({ processed: true, result });
  } catch (error) {
    await failMemoryJob({
      jobId: job._id.toString(),
      workerId,
      attempt: job.attempts,
      error,
    });
    return NextResponse.json({
      processed: true,
      failed: true,
      error: error instanceof Error ? error.message : "Transcription failed",
    });
  }
}

export async function GET(request: Request) {
  return processNext(request);
}

export async function POST(request: Request) {
  return processNext(request);
}
