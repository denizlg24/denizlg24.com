import { updateAgentGoalSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { updateGoal } from "@/lib/agent-memory/lifecycle";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { serializeAgentGoal } from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ goalId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  if (!(await getAgentMemorySettings()).releaseGates.reflection) {
    return NextResponse.json({ error: "Gate E is disabled" }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid goal update" }, { status: 400 });
  }
  const parsed = updateAgentGoalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid goal update" }, { status: 400 });
  }
  try {
    const { goalId } = await params;
    return NextResponse.json({
      goal: serializeAgentGoal(await updateGoal(goalId, parsed.data)),
    });
  } catch (error) {
    const status =
      error instanceof AgentMemoryPolicyError && error.code === "not-found"
        ? 404
        : error instanceof AgentMemoryPolicyError
          ? 409
          : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Goal update failed" },
      { status },
    );
  }
}
