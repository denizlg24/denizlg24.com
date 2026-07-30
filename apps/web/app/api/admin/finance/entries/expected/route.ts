import { financeExpectedEntryInputSchema } from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceLedgerEntry } from "@/lib/finance/dashboard";
import { createExpectedFinanceEntry } from "@/lib/finance/ledger";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeExpectedEntryInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid expected entry" },
      { status: 400 },
    );
  }
  try {
    const entry = await createExpectedFinanceEntry(parsed.data);
    if (!entry) throw new Error("Expected entry was not persisted");
    after(() => observeFinanceMemorySafely());
    return NextResponse.json(
      { entry: serializeFinanceLedgerEntry(entry) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[finance] Expected entry failed", error);
    return NextResponse.json(
      { error: "Failed to create expected entry" },
      { status: 500 },
    );
  }
}
