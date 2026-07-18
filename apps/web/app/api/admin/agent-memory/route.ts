import {
  agentCandidateSortSchema,
  agentCandidateStatusSchema,
  agentMemoryListResponseSchema,
  agentMemorySortSchema,
  agentMemoryStatusSchema,
  agentMemoryTypeSchema,
} from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

/**
 * Both lists sort by (optional numeric field desc, date desc, _id asc), so a
 * cursor is the sort tuple of the last returned row. `primary` is the numeric
 * sort value (importance/confidence) or null for date-only sorts.
 */
const cursorPayloadSchema = z.object({
  primary: z.number().min(0).max(1).nullable(),
  date: z.iso.datetime({ offset: true }),
  id: z.string().regex(/^[a-f0-9]{24}$/),
});
type CursorPayload = z.infer<typeof cursorPayloadSchema>;

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(value: string | null): CursorPayload | null | undefined {
  if (value === null) return null;
  try {
    const parsed = cursorPayloadSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

interface SortSpec {
  /** Numeric tie-broken field (descending), when the sort has one. */
  primaryField: "importance" | "confidence" | null;
  /** Descending date field the sort falls back to. */
  dateField: "updatedAt" | "createdAt";
}

const MEMORY_SORTS: Record<string, SortSpec> = {
  importance: { primaryField: "importance", dateField: "updatedAt" },
  confidence: { primaryField: "confidence", dateField: "updatedAt" },
  recent: { primaryField: null, dateField: "updatedAt" },
};

const CANDIDATE_SORTS: Record<string, SortSpec> = {
  confidence: { primaryField: "confidence", dateField: "createdAt" },
  recent: { primaryField: null, dateField: "createdAt" },
};

function sortStages(spec: SortSpec): Record<string, 1 | -1> {
  return {
    ...(spec.primaryField ? { [spec.primaryField]: -1 as const } : {}),
    [spec.dateField]: -1,
    _id: 1,
  };
}

function cursorFilter(
  spec: SortSpec,
  cursor: CursorPayload,
): Record<string, unknown> {
  const date = new Date(cursor.date);
  const id = new mongoose.Types.ObjectId(cursor.id);
  const dateTail = [
    { [spec.dateField]: { $lt: date } },
    { [spec.dateField]: date, _id: { $gt: id } },
  ];
  const { primaryField } = spec;
  const { primary } = cursor;
  if (primaryField === null || primary === null) {
    return { $or: dateTail };
  }
  return {
    $or: [
      { [primaryField]: { $lt: primary } },
      ...dateTail.map((tail) => ({ [primaryField]: primary, ...tail })),
    ],
  };
}

function nextCursor(
  spec: SortSpec,
  row: {
    _id: mongoose.Types.ObjectId;
    importance?: number;
    confidence?: number;
    updatedAt?: Date;
    createdAt?: Date;
  },
): string {
  const date = row[spec.dateField];
  if (!date) throw new Error(`Missing ${spec.dateField} on cursor row`);
  return encodeCursor({
    primary: spec.primaryField ? (row[spec.primaryField] ?? null) : null,
    date: date.toISOString(),
    id: String(row._id),
  });
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
  const memoryCursor = decodeCursor(
    request.nextUrl.searchParams.get("memoryCursor"),
  );
  const candidateCursor = decodeCursor(
    request.nextUrl.searchParams.get("candidateCursor"),
  );
  if (
    !statusResult.success ||
    !candidateStatusResult.success ||
    !memorySortResult.success ||
    !candidateSortResult.success ||
    (memoryTypeResult !== null && !memoryTypeResult.success) ||
    memoryCursor === undefined ||
    candidateCursor === undefined
  ) {
    return NextResponse.json({ error: "Invalid list filter" }, { status: 400 });
  }
  const status = statusResult.data;
  const candidateStatus = candidateStatusResult.data;
  const memorySort = MEMORY_SORTS[memorySortResult.data];
  const candidateSort = CANDIDATE_SORTS[candidateSortResult.data];
  const memoryFilter = {
    status,
    ...(memoryTypeResult ? { memoryType: memoryTypeResult.data } : {}),
  };
  const memoryQuery = memoryCursor
    ? { $and: [memoryFilter, cursorFilter(memorySort, memoryCursor)] }
    : memoryFilter;
  const candidateFilter = { status: candidateStatus };
  const candidateQuery = candidateCursor
    ? { $and: [candidateFilter, cursorFilter(candidateSort, candidateCursor)] }
    : candidateFilter;
  const [
    memories,
    candidates,
    totalMemories,
    totalCandidates,
    pendingCandidates,
    settings,
  ] = await Promise.all([
    // limit + 1 probes for a further page without a count round trip.
    AgentMemory.find(memoryQuery)
      .sort(sortStages(memorySort))
      .limit(limit + 1),
    AgentMemoryCandidate.find(candidateQuery)
      .sort(sortStages(candidateSort))
      .limit(limit + 1),
    AgentMemory.countDocuments(memoryFilter),
    AgentMemoryCandidate.countDocuments(candidateFilter),
    AgentMemoryCandidate.countDocuments({ status: "pending" }),
    getAgentMemorySettings(),
  ]);

  const memoryPage = memories.slice(0, limit);
  const candidatePage = candidates.slice(0, limit);
  const lastMemory = memoryPage.at(-1);
  const lastCandidate = candidatePage.at(-1);
  const response = agentMemoryListResponseSchema.parse({
    memories: memoryPage.map(serializeAgentMemory),
    candidates: candidatePage.map(serializeAgentMemoryCandidate),
    totalMemories,
    totalCandidates,
    pendingCandidates,
    nextMemoryCursor:
      memories.length > limit && lastMemory
        ? nextCursor(memorySort, lastMemory)
        : null,
    nextCandidateCursor:
      candidates.length > limit && lastCandidate
        ? nextCursor(candidateSort, lastCandidate)
        : null,
    pageSize: limit,
    settings: serializeAgentMemorySettings(settings),
  });
  return NextResponse.json(response);
}
