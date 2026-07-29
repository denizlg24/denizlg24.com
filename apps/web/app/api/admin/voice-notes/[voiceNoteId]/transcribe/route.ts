import { type NextRequest, NextResponse } from "next/server";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { serializeVoiceNote } from "@/lib/voice-notes/serialize";
import { enqueueVoiceNoteTranscription } from "@/lib/voice-notes/transcription";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ voiceNoteId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { voiceNoteId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
    };
    const result = await enqueueVoiceNoteTranscription(voiceNoteId, {
      retryFailed: body.force === true,
    });
    return NextResponse.json(
      {
        queued: result.queued,
        voiceNote: serializeVoiceNote(result.voiceNote),
      },
      { status: result.queued ? 202 : 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error && /not found|invalid/i.test(error.message)
        ? error.message
        : "Failed to queue transcription";
    return NextResponse.json(
      { error: message },
      { status: /not found/i.test(message) ? 404 : 400 },
    );
  }
}
