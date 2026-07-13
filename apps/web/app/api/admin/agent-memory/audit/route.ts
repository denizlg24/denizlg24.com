import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const requested = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requested)
    ? Math.min(200, Math.max(1, Math.trunc(requested)))
    : 100;
  const events = await AgentAuditEvent.find()
    .sort({ occurredAt: -1 })
    .limit(limit)
    .lean();
  return NextResponse.json({
    events: events.map((event) => ({
      auditId: event.auditId,
      action: event.action,
      actor: event.actor,
      targetType: event.targetType,
      targetId: event.targetId,
      targetRevision: event.targetRevision,
      reason: event.reason,
      metadata: event.metadata,
      contentRedacted: event.contentRedacted,
      occurredAt: event.occurredAt.toISOString(),
    })),
  });
}
