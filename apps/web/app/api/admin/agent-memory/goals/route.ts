import { createAgentGoalSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createGoal } from "@/lib/agent-memory/lifecycle";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { serializeAgentGoal } from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentGoal } from "@/models/AgentGoal";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const goals = await AgentGoal.find()
    .sort({ status: 1, updatedAt: -1 })
    .limit(200);
  return NextResponse.json({ goals: goals.map(serializeAgentGoal) });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  if (!(await getAgentMemorySettings()).releaseGates.reflection) {
    return NextResponse.json({ error: "Gate E is disabled" }, { status: 409 });
  }
  const parsed = createAgentGoalSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      goal: serializeAgentGoal(await createGoal(parsed.data)),
    });
  } catch (error) {
    const status = error instanceof AgentMemoryPolicyError ? 409 : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Goal creation failed",
      },
      { status },
    );
  }
}
