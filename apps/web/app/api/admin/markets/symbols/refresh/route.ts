import { type NextRequest, NextResponse } from "next/server";
import { refreshSymbolUniverse } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 120;

/**
 * Cron pulls the universe weekly, but a cold database would otherwise have an
 * empty search until the first Saturday. This is the manual seed.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    return NextResponse.json({ symbols: await refreshSymbolUniverse() });
  } catch (error) {
    console.error("[markets] Universe refresh failed", error);
    return NextResponse.json(
      { error: "Universe refresh failed" },
      { status: 502 },
    );
  }
}
