import { financeCsvImportInputSchema } from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceAccount } from "@/lib/finance/dashboard";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { importFinanceCsv } from "@/lib/finance/operations";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeCsvImportInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid finance CSV" }, { status: 400 });
  }
  try {
    const account = await importFinanceCsv(parsed.data);
    after(() => observeFinanceMemorySafely());
    return NextResponse.json(
      { account: serializeFinanceAccount(account) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[finance] CSV import failed", error);
    return NextResponse.json(
      { error: "Failed to import finance CSV" },
      { status: 422 },
    );
  }
}
