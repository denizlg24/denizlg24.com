import { agentReflectionOverviewSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  loadReflectionOverview,
  runManualReflection,
} from "@/lib/agent-memory/reflection";
import {
  serializeAgentGoal,
  serializeAgentMemoryRun,
  serializeAgentProcedure,
  serializeAgentUserModel,
  serializeAgentUserModelRevision,
} from "@/lib/agent-memory/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const overview = await loadReflectionOverview();
    return NextResponse.json(
      agentReflectionOverviewSchema.parse({
        goals: overview.goals.map(serializeAgentGoal),
        procedures: overview.procedures.map(serializeAgentProcedure),
        runs: overview.runs.map(serializeAgentMemoryRun),
        userModel: overview.userModel
          ? serializeAgentUserModel(overview.userModel)
          : null,
        revisions: overview.revisions.map(serializeAgentUserModelRevision),
      }),
    );
  } catch (error) {
    console.error("Error loading reflection overview:", error);
    return NextResponse.json(
      { error: "Failed to load reflection overview" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await runManualReflection());
  } catch (error) {
    console.error("Error running manual reflection:", error);
    return NextResponse.json(
      { error: "Failed to run manual reflection" },
      { status: 500 },
    );
  }
}
