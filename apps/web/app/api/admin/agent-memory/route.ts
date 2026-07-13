import {
  agentCandidateSortSchema,
  agentCandidateStatusSchema,
  agentMemoryListResponseSchema,
  agentMemorySortSchema,
  agentMemoryStatusSchema,
  agentMemoryTypeSchema,
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

function parsePage(value: string | null): number {
  const parsed = Number(value ?? 1);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1;
}

const MEMORY_SORTS: Record<string, Record<string, 1 | -1>> = {
  importance: { importance: -1, updatedAt: -1, _id: 1 },
  confidence: { confidence: -1, updatedAt: -1, _id: 1 },
  recent: { updatedAt: -1, _id: 1 },
};

const CANDIDATE_SORTS: Record<string, Record<string, 1 | -1>> = {
  confidence: { confidence: -1, createdAt: -1, _id: 1 },
  recent: { createdAt: -1, _id: 1 },
};

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
  const memorySortResult = agentMemorySortSchema.safeParse(
    request.nextUrl.searchParams.get("memorySort") ?? "importance",
  );
  const candidateSortResult = agentCandidateSortSchema.safeParse(
    request.nextUrl.searchParams.get("candidateSort") ?? "confidence",
  );
  const memoryTypeParam = request.nextUrl.searchParams.get("memoryType");
  const memoryTypeResult =
    memoryTypeParam && memoryTypeParam !== "all"
      ? agentMemoryTypeSchema.safeParse(memoryTypeParam)
      : null;
  if (
    !statusResult.success ||
    !candidateStatusResult.success ||
    !memorySortResult.success ||
    !candidateSortResult.success ||
    (memoryTypeResult !== null && !memoryTypeResult.success)
  ) {
    return NextResponse.json({ error: "Invalid list filter" }, { status: 400 });
  }
  const status = statusResult.data;
  const candidateStatus = candidateStatusResult.data;
  const memoryFilter = {
    status,
    ...(memoryTypeResult ? { memoryType: memoryTypeResult.data } : {}),
  };
  const memoryPage = parsePage(request.nextUrl.searchParams.get("memoryPage"));
  const candidatePage = parsePage(
    request.nextUrl.searchParams.get("candidatePage"),
  );
  const [
    memories,
    candidates,
    totalMemories,
    totalCandidates,
    pendingCandidates,
    settings,
  ] = await Promise.all([
    AgentMemory.find(memoryFilter)
      .sort(MEMORY_SORTS[memorySortResult.data])
      .skip((memoryPage - 1) * limit)
      .limit(limit),
    AgentMemoryCandidate.find({ status: candidateStatus })
      .sort(CANDIDATE_SORTS[candidateSortResult.data])
      .skip((candidatePage - 1) * limit)
      .limit(limit),
    AgentMemory.countDocuments(memoryFilter),
    AgentMemoryCandidate.countDocuments({ status: candidateStatus }),
    AgentMemoryCandidate.countDocuments({ status: "pending" }),
    getAgentMemorySettings(),
  ]);

  const response = agentMemoryListResponseSchema.parse({
    memories: memories.map(serializeAgentMemory),
    candidates: candidates.map(serializeAgentMemoryCandidate),
    totalMemories,
    totalCandidates,
    pendingCandidates,
    memoryPage,
    candidatePage,
    pageSize: limit,
    settings: serializeAgentMemorySettings(settings),
  });
  return NextResponse.json(response);
}
