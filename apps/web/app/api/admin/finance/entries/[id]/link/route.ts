import { financeManualLinkInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceLedgerEntry } from "@/lib/finance/dashboard";
import {
  FinanceLinkError,
  linkFinanceLedgerEntries,
  unlinkFinanceLedgerEntry,
} from "@/lib/finance/ledger";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  const parsed = financeManualLinkInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!mongoose.isValidObjectId(id) || !parsed.success) {
    return NextResponse.json(
      { error: "Invalid link request" },
      { status: 400 },
    );
  }
  if (!mongoose.isValidObjectId(parsed.data.bankLedgerId)) {
    return NextResponse.json(
      { error: "Invalid link request" },
      { status: 400 },
    );
  }
  await connectDB();
  try {
    const entry = await linkFinanceLedgerEntries(id, parsed.data.bankLedgerId);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    after(() => observeFinanceMemorySafely());
    return NextResponse.json({ entry: serializeFinanceLedgerEntry(entry) });
  } catch (error) {
    if (error instanceof FinanceLinkError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Manual link failed", error);
    return NextResponse.json({ error: "Failed to link" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid entry" }, { status: 400 });
  }
  await connectDB();
  try {
    const entry = await unlinkFinanceLedgerEntry(id);
    if (!entry) {
      return NextResponse.json(
        { error: "Entry is not linked" },
        { status: 404 },
      );
    }
    after(() => observeFinanceMemorySafely());
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[finance] Unlink failed", error);
    return NextResponse.json({ error: "Failed to unlink" }, { status: 500 });
  }
}
