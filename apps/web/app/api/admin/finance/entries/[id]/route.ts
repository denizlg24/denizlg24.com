import { financeLedgerEntryUpdateSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { after, type NextRequest, NextResponse } from "next/server";
import { serializeFinanceLedgerEntry } from "@/lib/finance/dashboard";
import {
  deleteFinanceLedgerEntry,
  FinanceLedgerEntryImmutableError,
  updateFinanceLedgerEntry,
} from "@/lib/finance/ledger";
import { observeFinanceMemorySafely } from "@/lib/finance/memory";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid entry" }, { status: 400 });
  }
  const parsed = financeLedgerEntryUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid entry" }, { status: 400 });
  }
  await connectDB();
  try {
    const entry = await updateFinanceLedgerEntry(id, parsed.data);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    after(() => observeFinanceMemorySafely());
    return NextResponse.json({ entry: serializeFinanceLedgerEntry(entry) });
  } catch (error) {
    if (error instanceof FinanceLedgerEntryImmutableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Entry update failed", error);
    return NextResponse.json(
      { error: "Failed to update entry" },
      { status: 500 },
    );
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
    const entry = await deleteFinanceLedgerEntry(id);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    after(() => observeFinanceMemorySafely());
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof FinanceLedgerEntryImmutableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Entry deletion failed", error);
    return NextResponse.json(
      { error: "Failed to delete entry" },
      { status: 500 },
    );
  }
}
