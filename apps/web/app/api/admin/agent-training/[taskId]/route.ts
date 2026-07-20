import { updateAgentTrainingTaskSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeTrainingTask } from "@/lib/agent-training/serialize";
import { updateTrainingTask } from "@/lib/agent-training/service";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const parsed = updateAgentTrainingTaskSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid training task", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { taskId } = await params;
    const task = await updateTrainingTask(taskId, parsed.data);
    return NextResponse.json({ task: serializeTrainingTask(task) });
  } catch (error) {
    console.error("[Agent Training] Task update failed", error);
    const message =
      error instanceof Error ? error.message : "Task update failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Training task not found" ? 404 : 400 },
    );
  }
}
