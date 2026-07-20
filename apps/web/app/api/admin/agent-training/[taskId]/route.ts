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
  const parsed = updateAgentTrainingTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid training task" },
      { status: 400 },
    );
  }
  try {
    const { taskId } = await params;
    const task = await updateTrainingTask(taskId, parsed.data);
    return NextResponse.json({ task: serializeTrainingTask(task) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Task update failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Training task not found" ? 404 : 400 },
    );
  }
}
