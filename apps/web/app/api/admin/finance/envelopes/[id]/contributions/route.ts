import { financeEnvelopeContributionInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  addFinanceEnvelopeContribution,
  FinanceEnvelopeConflictError,
  serializeFinanceEnvelope,
} from "@/lib/finance/envelopes";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }
  const parsed = financeEnvelopeContributionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid contribution" },
      { status: 400 },
    );
  }
  try {
    const envelope = await addFinanceEnvelopeContribution(id, parsed.data);
    if (!envelope) {
      return NextResponse.json(
        { error: "Envelope not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { envelope: serializeFinanceEnvelope(envelope) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof FinanceEnvelopeConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Contribution failed", error);
    return NextResponse.json(
      { error: "Failed to record contribution" },
      { status: 500 },
    );
  }
}
