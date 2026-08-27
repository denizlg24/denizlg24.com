import { type NextRequest, NextResponse } from "next/server";
import {
  generateFinanceBudgetSuggestions,
  listFinanceBudgetSuggestions,
} from "@/lib/finance/budget-coach";
import { requireAdmin } from "@/lib/require-admin";

const STATUSES = ["open", "applied", "dismissed"] as const;

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const status = request.nextUrl.searchParams
    .getAll("status")
    .filter((value): value is (typeof STATUSES)[number] =>
      STATUSES.includes(value as (typeof STATUSES)[number]),
    );
  return NextResponse.json({
    suggestions: await listFinanceBudgetSuggestions({
      status: status.length ? status : undefined,
    }),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json({
      suggestions: await generateFinanceBudgetSuggestions(),
    });
  } catch (error) {
    console.error("[finance] Budget suggestions failed", error);
    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 },
    );
  }
}
