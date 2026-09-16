import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { voiceNoteFacets } from "@/lib/voice-notes/query";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await voiceNoteFacets());
  } catch (error) {
    console.error("Failed to load voice note facets", error);
    return NextResponse.json(
      { error: "Failed to load voice note facets" },
      { status: 500 },
    );
  }
}
