import { type NextRequest, NextResponse } from "next/server";
import { loadAgentTaskRun } from "@/lib/agent-tasks/service";
import { requireAdmin } from "@/lib/require-admin";

/** The whole run, transcript included. A `running` one answers with what has been persisted so far. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { runId } = await params;
    return NextResponse.json({ run: await loadAgentTaskRun(runId) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Run lookup failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Run not found" ? 404 : 400 },
    );
  }
}
