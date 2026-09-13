import {
  financeLedgerQuerySchema,
  financeManualEntryInputSchema,
} from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceLedgerEntry } from "@/lib/finance/dashboard";
import { createManualFinanceEntry } from "@/lib/finance/ledger";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { queryFinanceLedger } from "@/lib/finance/queries";
import { requireAdmin } from "@/lib/require-admin";

function numberParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const search = request.nextUrl.searchParams;
  const parsed = financeLedgerQuerySchema.safeParse({
    accountId: search.get("accountId") ?? undefined,
    origin: search.get("origin") ?? undefined,
    state: search.get("state") ?? undefined,
    direction: search.get("direction") ?? undefined,
    category: search.get("category") ?? undefined,
    uncategorized: search.has("uncategorized")
      ? search.get("uncategorized") === "true"
      : undefined,
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
    search: search.get("search") ?? undefined,
    minAmountMinor: numberParam(search.get("minAmountMinor")),
    maxAmountMinor: numberParam(search.get("maxAmountMinor")),
    limit: numberParam(search.get("limit")),
    offset: numberParam(search.get("offset")),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ledger query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const result = await queryFinanceLedger(parsed.data);
    return NextResponse.json({
      entries: result.rows.map(serializeFinanceLedgerEntry),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.offset + result.rows.length < result.total,
    });
  } catch (error) {
    console.error("[finance] Ledger query failed", error);
    return NextResponse.json(
      { error: "Failed to query ledger" },
      { status: 500 },
    );
  }
}

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
