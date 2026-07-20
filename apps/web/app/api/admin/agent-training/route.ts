import { createAgentTrainingTaskSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeTrainingTask } from "@/lib/agent-training/serialize";
import {
  createTrainingTask,
  loadTrainingOverview,
} from "@/lib/agent-training/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json(await loadTrainingOverview());
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = createAgentTrainingTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid training task" },
      { status: 400 },
    );
  }
  try {
    const task = await createTrainingTask(parsed.data);
    return NextResponse.json(
      { task: serializeTrainingTask(task) },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Task creation failed",
      },
      { status: 400 },
    );
  }
}
