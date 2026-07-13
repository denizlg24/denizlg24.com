import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const { eventId } = await params;
  const event = await AgentEvidenceEvent.findOne({ eventId }).lean();
  if (!event)
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  return NextResponse.json({
    evidence: {
      eventId: event.eventId,
      sourceType: event.sourceType,
      sourceRef: event.sourceRef,
      contentHash: event.contentHash,
      snapshot: event.redactedAt ? undefined : event.snapshot,
      occurredAt: event.occurredAt.toISOString(),
      observedAt: event.observedAt.toISOString(),
      actor: event.actor,
      trust: event.trust,
      sensitivity: event.sensitivity,
      memoryEligible: event.memoryEligible,
      provenance: event.redactedAt ? {} : event.provenance,
      redactedAt: event.redactedAt?.toISOString(),
    },
  });
}
