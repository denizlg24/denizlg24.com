import { financeNaturalEntryInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeFinanceLedgerEntry } from "@/lib/finance/dashboard";
import { createNaturalFinanceEntry } from "@/lib/finance/operations";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeNaturalEntryInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid natural finance entry" },
      { status: 400 },
    );
  }
  try {
    const entry = await createNaturalFinanceEntry(parsed.data);
    if (!entry) throw new Error("Finance entry was not persisted");
    return NextResponse.json(
      { entry: serializeFinanceLedgerEntry(entry) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[finance] Natural entry failed", error);
    return NextResponse.json(
      { error: "Failed to parse finance entry" },
      { status: 422 },
    );
  }
}
