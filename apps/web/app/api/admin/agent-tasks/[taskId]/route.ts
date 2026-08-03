import { updateAgentTaskSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeAgentTask } from "@/lib/agent-tasks/serialize";
import { deleteAgentTask, updateAgentTask } from "@/lib/agent-tasks/service";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const parsed = updateAgentTaskSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid task", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { taskId } = await params;
    const task = await updateAgentTask(taskId, parsed.data);
    return NextResponse.json({ task: serializeAgentTask(task) });
  } catch (error) {
    console.error("[Agent Tasks] Task update failed", error);
    const message =
      error instanceof Error ? error.message : "Task update failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Task not found" ? 404 : 400 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { taskId } = await params;
    return NextResponse.json(await deleteAgentTask(taskId));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Task deletion failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Task not found" ? 404 : 400 },
    );
  }
}
