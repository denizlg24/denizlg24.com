import { agentMemoryGraphResponseSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { loadAgentMemoryGraph } from "@/lib/agent-memory/graph";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const graph = await loadAgentMemoryGraph();
  return NextResponse.json(agentMemoryGraphResponseSchema.parse(graph));
}
