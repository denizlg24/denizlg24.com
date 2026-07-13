import {
  agentMemoryFeedbackResponseSchema,
  createAgentMemoryFeedbackSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { recordAgentMemoryFeedback } from "@/lib/agent-memory/feedback";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid memory feedback" },
      { status: 400 },
    );
  }
  const parsed = createAgentMemoryFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid memory feedback" },
      { status: 400 },
    );
  }
  try {
    const { traceId } = await params;
    const result = await recordAgentMemoryFeedback(traceId, parsed.data);
    return NextResponse.json(agentMemoryFeedbackResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "not-found" ? 404 : 409 },
      );
    }
    console.error("Agent memory feedback failed", error);
    return NextResponse.json(
      { error: "Memory feedback failed" },
      { status: 500 },
    );
  }
}
