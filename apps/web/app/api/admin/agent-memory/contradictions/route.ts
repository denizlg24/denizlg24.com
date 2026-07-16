import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { serializeAgentMemory } from "@/lib/agent-memory/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentMemory } from "@/models/AgentMemory";

const PAGE_SIZE = 10;
// Bounded like the other agent-memory sweeps; single-owner data stays far
// below this, and it keeps the post-filter pagination exact.
const SCAN_LIMIT = 500;

function parsePage(value: string | null): number {
  const parsed = Number(value ?? 1);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1;
}

// Active memories carrying unresolved contradiction links, each grouped with
// the full records they conflict with so the owner can review and resolve.
// Only active-vs-active pairs are actionable: links to superseded/archived
// memories are moot (the consolidation sweep prunes them) and are dropped
// here so a group disappears as soon as its last real conflict is resolved.
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const page = parsePage(request.nextUrl.searchParams.get("page"));
  const memories = await AgentMemory.find({
    status: "active",
    "contradictionIds.0": { $exists: true },
  })
    .sort({ updatedAt: -1, _id: 1 })
    .limit(SCAN_LIMIT);

  const conflictIds = [
    ...new Set(
      memories.flatMap((memory) =>
        memory.contradictionIds.map((id) => id.toString()),
      ),
    ),
  ].filter((id) => mongoose.isValidObjectId(id));
  const conflictDocs = await AgentMemory.find({
    _id: { $in: conflictIds },
    status: "active",
  });
  const conflictsById = new Map(
    conflictDocs.map((doc) => [doc._id.toString(), doc]),
  );

  const seenPairs = new Set<string>();
  const groups = memories
    .map((memory) => ({
      memory: serializeAgentMemory(memory),
      conflicts: memory.contradictionIds
        .map((id) => conflictsById.get(id.toString()))
        .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
        .map((doc) => serializeAgentMemory(doc)),
    }))
    .filter((group) => group.conflicts.length > 0)
    .filter((group) => {
      // Deduplicate reciprocal pairs: each unordered pair (A,B) emitted once.
      // Use lexicographic ordering for the pair key.
      const memoryId = group.memory.id;
      const hasUnseen = group.conflicts.some((conflict) => {
        const conflictId = conflict.id;
        const pairKey =
          memoryId < conflictId
            ? `${memoryId}:${conflictId}`
            : `${conflictId}:${memoryId}`;
        return !seenPairs.has(pairKey);
      });
      if (!hasUnseen) return false;
      // Mark all pairs from this group as seen.
      for (const conflict of group.conflicts) {
        const conflictId = conflict.id;
        const pairKey =
          memoryId < conflictId
            ? `${memoryId}:${conflictId}`
            : `${conflictId}:${memoryId}`;
        seenPairs.add(pairKey);
      }
      return true;
    });

  return NextResponse.json({
    groups: groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: groups.length,
    page,
    pageSize: PAGE_SIZE,
  });
}
