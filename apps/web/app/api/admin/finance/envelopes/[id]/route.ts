import { financeEnvelopeUpdateSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { getFinanceEnvelopeDetail } from "@/lib/finance/envelope-detail";
import {
  deleteFinanceEnvelope,
  FinanceEnvelopeConflictError,
  serializeFinanceEnvelope,
  updateFinanceEnvelope,
} from "@/lib/finance/envelopes";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }
  try {
    const detail = await getFinanceEnvelopeDetail(id);
    if (!detail) {
      return NextResponse.json(
        { error: "Envelope not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[finance] Envelope detail failed", error);
    return NextResponse.json(
      { error: "Failed to load envelope" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }
  const parsed = financeEnvelopeUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }
  try {
    const envelope = await updateFinanceEnvelope(id, parsed.data);
    if (!envelope) {
      return NextResponse.json(
        { error: "Envelope not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ envelope: serializeFinanceEnvelope(envelope) });
  } catch (error) {
    if (error instanceof FinanceEnvelopeConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Envelope update failed", error);
    return NextResponse.json(
      { error: "Failed to update envelope" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }
  const deleted = await deleteFinanceEnvelope(id);
  if (!deleted) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
