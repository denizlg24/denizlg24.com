import { createGateway } from "@ai-sdk/gateway";
import { generateSpeech } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getTtsSettings } from "@/lib/tts-settings";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  let text: unknown;
  try {
    text = (await request.json()).text;
  } catch {
    return NextResponse.json(
      { error: "Invalid speech request" },
      { status: 400 },
    );
  }
  if (typeof text !== "string" || !text.trim() || text.length > 2_000) {
    return NextResponse.json(
      { error: "Speech text must be 1–2,000 characters" },
      { status: 400 },
    );
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI Gateway is not configured" },
      { status: 503 },
    );
  }
  try {
    const settings = await getTtsSettings();
    const google = settings.effectiveTtsModel.startsWith("google/");
    const result = await generateSpeech({
      model: createGateway({ apiKey }).speechModel(settings.effectiveTtsModel),
      text: text.trim(),
      voice: settings.effectiveTtsVoice,
      ...(google && settings.ttsInstructions?.trim()
        ? { instructions: settings.ttsInstructions.trim() }
        : {}),
      outputFormat: google ? "wav" : "mp3",
      abortSignal: request.signal,
    });
    return new Response(new Uint8Array(result.audio.uint8Array), {
      headers: {
        "Content-Type": google ? "audio/wav" : "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Speech generation failed", error);
    return NextResponse.json(
      { error: "Speech generation failed" },
      { status: 502 },
    );
  }
}
