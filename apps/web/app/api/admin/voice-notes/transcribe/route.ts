import { type NextRequest, NextResponse } from "next/server";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { isSupportedAudio, MAX_AUDIO_BYTES } from "@/lib/voice-notes/audio";
import { transcribeAudioFile } from "@/lib/voice-notes/transcription";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Transcribes audio without storing it. Dictation into the agent composer is
 * not a recording the owner keeps — the resulting message is what gets saved.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const data = await request.formData();
    const entry = data.get("file");
    if (!(entry instanceof File)) {
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });
    }
    if (entry.size === 0 || entry.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio must be between 1 byte and 25 MB" },
        { status: 413 },
      );
    }
    if (!isSupportedAudio(entry)) {
      return NextResponse.json(
        { error: "Unsupported audio format" },
        { status: 415 },
      );
    }
    const result = await transcribeAudioFile(entry, "agent-dictation");
    return NextResponse.json({
      text: result.text,
      language: result.language,
      model: result.model,
      durationSeconds: result.durationSeconds,
    });
  } catch (error) {
    console.error("Failed to transcribe audio", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 },
    );
  }
}
