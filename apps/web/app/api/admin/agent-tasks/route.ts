import { createAgentTaskSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeAgentTask } from "@/lib/agent-tasks/serialize";
import {
  createAgentTask,
  loadAgentTaskOverview,
} from "@/lib/agent-tasks/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json(await loadAgentTaskOverview());
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const parsed = createAgentTaskSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid task", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const task = await createAgentTask(parsed.data);
    return NextResponse.json(
      { task: serializeAgentTask(task) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Agent Tasks] Task creation failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Task creation failed",
      },
      { status: 400 },
    );
  }
}
