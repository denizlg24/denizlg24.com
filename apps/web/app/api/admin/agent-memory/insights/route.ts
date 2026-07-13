import { type NextRequest, NextResponse } from "next/server";
import {
  listAgentInsights,
  runInsightSweep,
} from "@/lib/agent-memory/insights";
import { serializeAgentInsight } from "@/lib/agent-memory/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { insights, stats } = await listAgentInsights();
  return NextResponse.json({
    insights: insights.map(serializeAgentInsight),
    stats,
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json(await runInsightSweep(new Date(), { force: true }));
}
