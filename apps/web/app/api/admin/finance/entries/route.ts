import { financeManualEntryInputSchema } from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceLedgerEntry } from "@/lib/finance/dashboard";
import { createManualFinanceEntry } from "@/lib/finance/ledger";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeManualEntryInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid finance entry" },
      { status: 400 },
    );
  }
  try {
    const entry = await createManualFinanceEntry(parsed.data);
    if (!entry) throw new Error("Finance entry was not persisted");
    after(() => observeFinanceMemorySafely());
    return NextResponse.json(
      { entry: serializeFinanceLedgerEntry(entry) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[finance] Manual entry failed", error);
    return NextResponse.json(
      { error: "Failed to create finance entry" },
      { status: 500 },
    );
  }
}
