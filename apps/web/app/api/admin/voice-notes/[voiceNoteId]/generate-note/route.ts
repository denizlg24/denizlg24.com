import { type NextRequest, NextResponse } from "next/server";
import { serializeNote } from "@/lib/note-route-utils";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";
import { generateNoteFromVoice } from "@/lib/voice-notes/generate-note";
import { serializeVoiceNote } from "@/lib/voice-notes/serialize";

export const maxDuration = 120;

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
      groupIds?: unknown;
      model?: unknown;
      instructions?: unknown;
    };
    const result = await generateNoteFromVoice({
      voiceNoteId,
      groupIds: Array.isArray(body.groupIds)
        ? body.groupIds.filter(
            (value): value is string => typeof value === "string",
          )
        : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      instructions:
        typeof body.instructions === "string" ? body.instructions : undefined,
    });
    return NextResponse.json({
      note: serializeNote(result.note),
      voiceNote: serializeVoiceNote({
        ...result.voiceNote,
        noteIds: [...result.voiceNote.noteIds, result.note._id],
      }),
      usage: result.usage,
    });
  } catch (error) {
    const message =
      error instanceof Error && /not found|no transcript/i.test(error.message)
        ? error.message
        : "Failed to generate note";
    return NextResponse.json(
      { error: message },
      { status: /not found/i.test(message) ? 404 : 400 },
    );
  }
}
