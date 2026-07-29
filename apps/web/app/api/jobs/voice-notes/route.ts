import { NextResponse } from "next/server";
import { isAuthorizedJobRequest } from "@/lib/job-authorization";
import { enqueueNightlyVoiceTranscriptions } from "@/lib/voice-notes/transcription";

export const maxDuration = 60;

async function schedule(request: Request) {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await enqueueNightlyVoiceTranscriptions());
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
