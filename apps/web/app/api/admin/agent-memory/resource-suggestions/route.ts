import { generateAgentResourceSuggestionsSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import {
  generateResourceSuggestions,
  listResourceSuggestions,
} from "@/lib/agent-memory/resource-suggestions";
import { serializeAgentResourceSuggestion } from "@/lib/agent-memory/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const result = await listResourceSuggestions(status);
    return NextResponse.json({
      suggestions: result.suggestions.map(serializeAgentResourceSuggestion),
      stats: result.stats,
    });
  } catch (error) {
    console.error("Error listing resource suggestions:", error);
    return NextResponse.json(
      { error: "Failed to list resource suggestions" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = generateAgentResourceSuggestionsSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid generation request" },
      { status: 400 },
    );
  }
  try {
    const outcome = await generateResourceSuggestions(parsed.data);
    return NextResponse.json({
      created: outcome.created,
      skipped: outcome.skipped,
      suggestions: outcome.suggestions.map(serializeAgentResourceSuggestion),
    });
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      const status = error.code === "not-found" ? 404 : 409;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    console.error("Error generating resource suggestions:", error);
    return NextResponse.json(
      { error: "Failed to generate resource suggestions" },
      { status: 500 },
    );
  }
}
