import { NextResponse } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";
import {
  enqueueNightlyVoiceTranscriptions,
  repairTranscribedVoiceNotes,
} from "@/lib/voice-notes/transcription";

export const maxDuration = 300;

async function schedule(request: Request) {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const scheduled = await enqueueNightlyVoiceTranscriptions();
    const repair = await repairTranscribedVoiceNotes();
    return NextResponse.json({ ...scheduled, repair });
  } catch (error) {
    console.error("[voice-notes] Nightly scheduling failed", error);
    return NextResponse.json(
      { error: "Failed to schedule voice transcriptions" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return schedule(request);
}

export async function POST(request: Request) {
  return schedule(request);
}
