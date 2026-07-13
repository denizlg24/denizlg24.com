import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { scheduleAgentMemoryBackfill } from "@/lib/agent-memory/backfill";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.evidenceLedger) {
    return NextResponse.json(
      { error: "Gate A must be enabled before scheduling backfill" },
      { status: 409 },
    );
  }
  return NextResponse.json(await scheduleAgentMemoryBackfill());
}
