import { type NextRequest, NextResponse } from "next/server";
import { createFinanceNarrative } from "@/lib/finance/operations";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await createFinanceNarrative());
  } catch (error) {
    console.error("[finance] Narrative generation failed", error);
    return NextResponse.json(
      { error: "Failed to generate finance narrative" },
      { status: 500 },
    );
  }
}
