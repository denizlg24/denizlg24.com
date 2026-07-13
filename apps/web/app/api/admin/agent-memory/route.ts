import {
  agentCandidateStatusSchema,
  agentMemoryListResponseSchema,
  agentMemoryStatusSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  serializeAgentMemory,
  serializeAgentMemoryCandidate,
  serializeAgentMemorySettings,
} from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryCandidate } from "@/models/AgentMemoryCandidate";

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? 50);
  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(1, Math.trunc(parsed)))
    : 50;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const statusResult = agentMemoryStatusSchema.safeParse(
    request.nextUrl.searchParams.get("status") ?? "active",
  );
  const candidateStatusResult = agentCandidateStatusSchema.safeParse(
    request.nextUrl.searchParams.get("candidateStatus") ?? "pending",
  );
  if (!statusResult.success || !candidateStatusResult.success) {
    return NextResponse.json(
      { error: "Invalid status filter" },
      { status: 400 },
    );
  }
  const status = statusResult.data;
  const candidateStatus = candidateStatusResult.data;
  const [memories, candidates, totalMemories, pendingCandidates, settings] =
    await Promise.all([
      AgentMemory.find({ status })
        .sort({ importance: -1, updatedAt: -1 })
        .limit(limit),
      AgentMemoryCandidate.find({ status: candidateStatus })
        .sort({ confidence: -1, createdAt: -1 })
        .limit(limit),
      AgentMemory.countDocuments({ status }),
      AgentMemoryCandidate.countDocuments({ status: "pending" }),
      getAgentMemorySettings(),
    ]);

  const response = agentMemoryListResponseSchema.parse({
    memories: memories.map(serializeAgentMemory),
    candidates: candidates.map(serializeAgentMemoryCandidate),
    totalMemories,
    pendingCandidates,
    settings: serializeAgentMemorySettings(settings),
  });
  return NextResponse.json(response);
}
