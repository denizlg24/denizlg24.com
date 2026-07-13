import { agentMemoryGraphResponseSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { loadAgentMemoryGraph } from "@/lib/agent-memory/graph";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const graph = await loadAgentMemoryGraph();
    return NextResponse.json(agentMemoryGraphResponseSchema.parse(graph));
  } catch (error) {
    console.error("Error loading agent memory graph:", error);
    return NextResponse.json(
      { error: "Failed to load agent memory graph" },
      { status: 500 },
    );
  }
}
