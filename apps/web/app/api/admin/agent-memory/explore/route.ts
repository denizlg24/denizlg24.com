import {
  agentMemoryExploreRequestSchema,
  agentMemoryExploreResponseSchema,
} from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  RETRIEVABLE_SENSITIVITIES,
  retrievalQueryContainsDeniedContent,
} from "@/lib/agent-memory/retrieval";
import { serializeAgentMemory } from "@/lib/agent-memory/serialize";
import { scoreToCosine } from "@/lib/agent-memory/similarity";
import { AGENT_MEMORY_VECTOR_CONFIG } from "@/lib/agent-memory/vector-config";
import { embedText } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";

const EVENTS_PER_MEMORY = 3;

/**
 * Embedding-only recall probe for the explore dock: the query is embedded and
 * matched against memory vectors directly — no LLM reranking or synthesis.
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
  const { query, limit } = body.data;
  if (retrievalQueryContainsDeniedContent(query)) {
    return NextResponse.json(
      { error: "Query touches content the memory system refuses to recall" },
      { status: 422 },
    );
  }

  await connectDB();
  const startedAt = Date.now();
  const embedded = await embedText({
    purpose: "agent-memory-retrieval",
    source: "agent-memory-explore",
    model: AGENT_MEMORY_VECTOR_CONFIG.model,
    dimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
    value: query,
  });
  const hits = await AgentMemoryEmbedding.aggregate<{
    memoryId: mongoose.Types.ObjectId;
    score: number;
  }>([
    {
      $vectorSearch: {
        index: AGENT_MEMORY_VECTOR_CONFIG.indexName,
        path: AGENT_MEMORY_VECTOR_CONFIG.path,
        queryVector: embedded.vector,
        numCandidates: Math.max(150, limit * 15),
        limit,
        filter: {
          model: AGENT_MEMORY_VECTOR_CONFIG.model,
          status: "active",
          sensitivity: { $in: RETRIEVABLE_SENSITIVITIES },
        },
      },
    },
    {
      $project: { _id: 0, memoryId: 1, score: { $meta: "vectorSearchScore" } },
    },
  ]);
  // scoreToCosine folds Atlas's (1 + cosine) / 2 back to cosine; anything at 0
  // is noise the index surfaced only to fill the requested limit.
  const scored = hits
    .map((hit) => ({
      memoryId: String(hit.memoryId),
      score: scoreToCosine(hit.score),
    }))
    .filter((hit) => hit.score > 0);

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
    .select("eventId sourceType sourceRef snapshot occurredAt actor trust")
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
    results,
  });
  return NextResponse.json(response);
}
