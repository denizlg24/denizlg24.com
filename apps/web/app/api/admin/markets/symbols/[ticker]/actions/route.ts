import { type NextRequest, NextResponse } from "next/server";
import { getActions, MarketsNotConfiguredError } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { ticker } = await params;
  try {
    return NextResponse.json(await getActions(ticker));
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Corporate actions failed", error);
    return NextResponse.json(
      { error: "Corporate actions failed" },
      { status: 502 },
    );
  }
}
