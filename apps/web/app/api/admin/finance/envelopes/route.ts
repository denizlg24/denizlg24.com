import { financeEnvelopeInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  createFinanceEnvelope,
  FinanceEnvelopeConflictError,
  listFinanceEnvelopes,
  serializeFinanceEnvelope,
} from "@/lib/finance/envelopes";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const includeArchived =
    request.nextUrl.searchParams.get("includeArchived") === "true";
  const envelopes = await listFinanceEnvelopes({ includeArchived });
  return NextResponse.json({
    envelopes: envelopes.map(serializeFinanceEnvelope),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeEnvelopeInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }
  try {
    const envelope = await createFinanceEnvelope(parsed.data);
    return NextResponse.json(
      { envelope: serializeFinanceEnvelope(envelope) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof FinanceEnvelopeConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Envelope creation failed", error);
    return NextResponse.json(
      { error: "Failed to create envelope" },
      { status: 500 },
    );
  }
}
