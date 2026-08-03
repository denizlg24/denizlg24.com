import { type NextRequest, NextResponse } from "next/server";
import { enqueueManualAgentTaskRun } from "@/lib/agent-tasks/scheduling";
import { serializeAgentTaskRun } from "@/lib/agent-tasks/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { taskId } = await params;
    const run = await enqueueManualAgentTaskRun(taskId);
    return NextResponse.json(
      { run: serializeAgentTaskRun(run) },
      { status: 202 },
    );
  } catch (error) {
    console.error("[Agent Tasks] Run enqueue failed", error);
    const message =
      error instanceof Error ? error.message : "Run enqueue failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Task not found" ? 404 : 400 },
    );
  }
}
