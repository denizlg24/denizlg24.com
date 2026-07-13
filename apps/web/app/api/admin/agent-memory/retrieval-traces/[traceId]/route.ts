import { agentRetrievalTraceResponseSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeAgentRetrievalTrace } from "@/lib/agent-memory/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentRetrievalTrace } from "@/models/AgentRetrievalTrace";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const { traceId } = await params;
  const trace = await AgentRetrievalTrace.findOne({ traceId }).lean();
  if (!trace) {
    return NextResponse.json(
      { error: "Retrieval trace not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(
    agentRetrievalTraceResponseSchema.parse({
      trace: serializeAgentRetrievalTrace(trace),
    }),
  );
}
