import { agentInsightActionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { actOnAgentInsight } from "@/lib/agent-memory/insights";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { serializeAgentInsight } from "@/lib/agent-memory/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ insightId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = agentInsightActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid insight action" },
      { status: 400 },
    );
  }

  try {
    const { insightId } = await params;
    const insight = await actOnAgentInsight({
      insightId,
      action: parsed.data.action,
      snoozedUntil: parsed.data.snoozedUntil
        ? new Date(parsed.data.snoozedUntil)
        : undefined,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ insight: serializeAgentInsight(insight) });
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      const status = error.code === "not-found" ? 404 : 409;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    return NextResponse.json(
      { error: "Insight action failed" },
      { status: 500 },
    );
  }
}
