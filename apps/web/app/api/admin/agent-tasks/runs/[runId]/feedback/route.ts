import { createAgentTaskFeedbackSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { recordAgentTaskFeedback } from "@/lib/agent-tasks/learning";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const parsed = createAgentTaskFeedbackSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid feedback", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { runId } = await params;
    return NextResponse.json(await recordAgentTaskFeedback(runId, parsed.data));
  } catch (error) {
    console.error("[Agent Tasks] Feedback request failed", error);
    const message = error instanceof Error ? error.message : "Feedback failed";
    return NextResponse.json(
      { error: message },
      {
        status:
          message === "Run not found"
            ? 404
            : message === "Run already has feedback" ||
                message === "Run has not finished yet"
              ? 409
              : 400,
      },
    );
  }
}
