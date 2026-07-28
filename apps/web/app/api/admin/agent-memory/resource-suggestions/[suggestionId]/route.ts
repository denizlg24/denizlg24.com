import { agentResourceSuggestionDecisionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import {
  acceptResourceSuggestion,
  attachExistingPersonSuggestion,
  dismissResourceSuggestion,
  getResourceSuggestionMemories,
  splitMemoryFromResourceSuggestion,
} from "@/lib/agent-memory/resource-suggestions";
import {
  serializeAgentMemory,
  serializeAgentResourceSuggestion,
} from "@/lib/agent-memory/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { suggestionId } = await params;
    const memories = await getResourceSuggestionMemories(suggestionId);
    return NextResponse.json({
      memories: memories.map(serializeAgentMemory),
    });
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "not-found" ? 404 : 409 },
      );
    }
    console.error("Error loading resource suggestion memories:", error);
    return NextResponse.json(
      { error: "Failed to load related memories" },
      { status: 500 },
    );
  }
}

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
        : parsed.data.action === "attach"
          ? await attachExistingPersonSuggestion({
              suggestionId,
              resourceId: parsed.data.resourceId as string,
              reason: parsed.data.reason,
            })
          : parsed.data.action === "split-memory"
            ? await splitMemoryFromResourceSuggestion({
                suggestionId,
                memoryId: parsed.data.memoryId as string,
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
