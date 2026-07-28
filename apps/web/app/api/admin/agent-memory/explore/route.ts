import {
  agentMemoryExploreRequestSchema,
  agentMemoryExploreResponseSchema,
} from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { agentMemoryQueryEmbeddingRequest } from "@/lib/agent-memory/query-embedding";
import {
  RETRIEVABLE_SENSITIVITIES,
  retrievalQueryContainsDeniedContent,
} from "@/lib/agent-memory/retrieval";
import { serializeAgentMemory } from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { scoreToCosine } from "@/lib/agent-memory/similarity";
import { AGENT_MEMORY_VECTOR_CONFIG } from "@/lib/agent-memory/vector-config";
import { embedMultimodal } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";

const EVENTS_PER_MEMORY = 3;
/**
 * $vectorSearch has no "return everything above a score" mode, so the cut is
 * made client-side and this only has to be larger than any plausible result
 * set. It is capped rather than unbounded because the aggregation still hydrates
 * one document per candidate.
 */
const CANDIDATE_CEILING = 1_000;

/**
 * Embedding-only recall probe for the explore dock: the query is embedded and
 * matched against memory vectors directly — no LLM reranking or synthesis.
 * Uncapped by count — every memory clearing `retrieval.exploreMinSimilarity`
 * comes back, so the threshold is the only knob.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = agentMemoryExploreRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid explore query" },
      { status: 400 },
    );
  }
  const { query } = body.data;
  if (retrievalQueryContainsDeniedContent(query)) {
    return NextResponse.json(
      { error: "Query touches content the memory system refuses to recall" },
      { status: 422 },
    );
  }

  await connectDB();
  const startedAt = Date.now();
  const { exploreMinSimilarity: minSimilarity } = (
    await getAgentMemorySettings()
  ).retrieval;
  let queryVector: number[] | undefined;
  try {
    const embedded = await embedMultimodal(
      agentMemoryQueryEmbeddingRequest(query, "agent-memory-explore"),
    );
    queryVector = embedded.vectors[0];
  } catch (error) {
    console.error("Error embedding agent memory explore query:", {
      model: AGENT_MEMORY_VECTOR_CONFIG.model,
      queryLength: query.length,
      error,
    });
  }
  if (!queryVector) {
    return NextResponse.json(
      { error: "Embedding provider returned no query vector" },
      { status: 502 },
    );
  }
  const searchFilter = {
    model: AGENT_MEMORY_VECTOR_CONFIG.model,
    status: "active" as const,
    sensitivity: { $in: RETRIEVABLE_SENSITIVITIES },
  };
  const limit = Math.max(
    1,
    Math.min(
      CANDIDATE_CEILING,
      await AgentMemoryEmbedding.countDocuments(searchFilter),
    ),
  );
  const hits = await AgentMemoryEmbedding.aggregate<{
    memoryId: mongoose.Types.ObjectId;
    score: number;
  }>([
    {
      $vectorSearch: {
        index: AGENT_MEMORY_VECTOR_CONFIG.indexName,
        path: AGENT_MEMORY_VECTOR_CONFIG.path,
        queryVector,
        numCandidates: Math.min(10_000, Math.max(150, limit * 2)),
        limit,
        filter: searchFilter,
      },
    },
    {
      $project: { _id: 0, memoryId: 1, score: { $meta: "vectorSearchScore" } },
    },
  ]);
  // scoreToCosine folds Atlas's (1 + cosine) / 2 back to cosine. Several
  // revisions of one memory can be indexed, so the best score per memory wins.
  const bestByMemory = new Map<string, number>();
  for (const hit of hits) {
    const memoryId = String(hit.memoryId);
    const score = scoreToCosine(hit.score);
    if (score < minSimilarity) continue;
    const existing = bestByMemory.get(memoryId);
    if (existing === undefined || existing < score) {
      bestByMemory.set(memoryId, score);
    }
  }
  const scored = [...bestByMemory.entries()]
    .map(([memoryId, score]) => ({ memoryId, score }))
    .sort((a, b) => b.score - a.score);

  const memories = await AgentMemory.find({
    _id: {
      $in: scored.map((hit) => new mongoose.Types.ObjectId(hit.memoryId)),
    },
    status: "active",
  });
  const memoryById = new Map(
    memories.map((memory) => [String(memory._id), memory]),
  );
  const eventIds = [
    ...new Set(memories.flatMap((memory) => memory.evidenceIds)),
  ];
  const events = await AgentEvidenceEvent.find({
    eventId: { $in: eventIds },
    redactedAt: { $exists: false },
  })
    .select(
      "eventId sourceType sourceRef snapshot occurredAt actor trust provenance",
    )
    .lean();
  const eventById = new Map(events.map((event) => [event.eventId, event]));

  const results = scored.flatMap((hit) => {
    const memory = memoryById.get(hit.memoryId);
    if (!memory) return [];
    const memoryEvents = memory.evidenceIds
      .flatMap((eventId) => eventById.get(eventId) ?? [])
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, EVENTS_PER_MEMORY)
      .map((event) => ({
        eventId: event.eventId,
        sourceType: event.sourceType,
        sourceRef: event.sourceRef,
        snapshot: event.snapshot,
        occurredAt: event.occurredAt.toISOString(),
        actor: event.actor,
        trust: event.trust,
        ...(event.provenance?.hasImage === true &&
        typeof event.provenance?.attachmentUrl === "string"
          ? { imageUrl: event.provenance.attachmentUrl }
          : {}),
      }));
    return [
      {
        memory: serializeAgentMemory(memory),
        score: hit.score,
        events: memoryEvents,
      },
    ];
  });

  const response = agentMemoryExploreResponseSchema.parse({
    query,
    tookMs: Date.now() - startedAt,
    minSimilarity,
    results,
  });
  return NextResponse.json(response);
}
