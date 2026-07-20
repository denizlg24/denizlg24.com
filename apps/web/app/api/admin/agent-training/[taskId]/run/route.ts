import { type NextRequest, NextResponse } from "next/server";
import { enqueueManualTrainingRun } from "@/lib/agent-training/scheduling";
import { serializeTrainingRun } from "@/lib/agent-training/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { taskId } = await params;
    const run = await enqueueManualTrainingRun(taskId);
    return NextResponse.json(
      { run: serializeTrainingRun(run) },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Run enqueue failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Training task not found" ? 404 : 400 },
    );
  }
}
