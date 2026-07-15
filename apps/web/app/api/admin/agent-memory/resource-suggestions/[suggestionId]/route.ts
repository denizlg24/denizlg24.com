import { agentResourceSuggestionDecisionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import {
  acceptResourceSuggestion,
  dismissResourceSuggestion,
} from "@/lib/agent-memory/resource-suggestions";
import { serializeAgentResourceSuggestion } from "@/lib/agent-memory/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const body = await request.json().catch(() => null);
  const parsed = agentResourceSuggestionDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid suggestion decision" },
      { status: 400 },
    );
  }

  try {
    const { suggestionId } = await params;
    const suggestion =
      parsed.data.action === "dismiss"
        ? await dismissResourceSuggestion({
            suggestionId,
            reason: parsed.data.reason,
          })
        : await acceptResourceSuggestion({
            suggestionId,
            reason: parsed.data.reason,
            draftOverride: parsed.data.draft,
          });
    return NextResponse.json({
      suggestion: serializeAgentResourceSuggestion(suggestion),
    });
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      const status = error.code === "not-found" ? 404 : 409;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    console.error("Error deciding resource suggestion:", error);
    return NextResponse.json(
      { error: "Suggestion decision failed" },
      { status: 500 },
    );
  }
}
