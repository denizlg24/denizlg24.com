import {
  type SpeechNarrateResponse,
  speechNarrateRequestSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { narrateForSpeech } from "@/lib/speech-narration";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid narration request" },
      { status: 400 },
    );
  }
  const parsed = speechNarrateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid narration request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const spoken = await narrateForSpeech(parsed.data);
    return NextResponse.json<SpeechNarrateResponse>({ spoken });
  } catch (error) {
    console.error("Speech narration failed", error);
    return NextResponse.json(
      { error: "Speech narration failed" },
      { status: 502 },
    );
  }
}
