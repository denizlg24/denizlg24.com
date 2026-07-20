import { createAgentTrainingFeedbackSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { recordTrainingFeedback } from "@/lib/agent-training/learning";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = createAgentTrainingFeedbackSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid training feedback" },
      { status: 400 },
    );
  }
  try {
    const { runId } = await params;
    return NextResponse.json(await recordTrainingFeedback(runId, parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feedback failed";
    return NextResponse.json(
      { error: message },
      { status: message.includes("not awaiting") ? 409 : 400 },
    );
  }
}
