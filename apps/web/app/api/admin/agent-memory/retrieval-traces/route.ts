import { agentRetrievalTraceListResponseSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { serializeAgentRetrievalTrace } from "@/lib/agent-memory/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentRetrievalTrace } from "@/models/AgentRetrievalTrace";

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? 50);
  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(1, Math.trunc(parsed)))
    : 50;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (conversationId && !mongoose.isValidObjectId(conversationId)) {
    return NextResponse.json(
      { error: "Invalid conversationId filter" },
      { status: 400 },
    );
  }
  await connectDB();
  const traces = await AgentRetrievalTrace.find(
    conversationId
      ? { conversationId: new mongoose.Types.ObjectId(conversationId) }
      : {},
  )
    .sort({ createdAt: -1 })
    .limit(parseLimit(request.nextUrl.searchParams.get("limit")))
    .lean();
  return NextResponse.json(
    agentRetrievalTraceListResponseSchema.parse({
      traces: traces.map(serializeAgentRetrievalTrace),
    }),
  );
}
