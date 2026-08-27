import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  removeFinanceEnvelopeContribution,
  serializeFinanceEnvelope,
} from "@/lib/finance/envelopes";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string; contributionId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id, contributionId } = await context.params;
  if (
    !mongoose.isValidObjectId(id) ||
    !mongoose.isValidObjectId(contributionId)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const envelope = await removeFinanceEnvelopeContribution(id, contributionId);
  if (!envelope) {
    return NextResponse.json(
      { error: "Contribution not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ envelope: serializeFinanceEnvelope(envelope) });
}
