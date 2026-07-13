import type {
  AgentMemoryCandidate as AgentMemoryCandidateWire,
  AgentMemorySettings as AgentMemorySettingsWire,
  AgentMemory as AgentMemoryWire,
} from "@repo/schemas";
import type { IAgentMemory } from "@/models/AgentMemory";
import type { IAgentMemoryCandidate } from "@/models/AgentMemoryCandidate";
import type { IAgentMemorySettings } from "@/models/AgentMemorySettings";
import type { IAgentRetrievalTrace } from "@/models/AgentRetrievalTrace";

function iso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

function serializeTemporal(temporal: IAgentMemory["temporal"]) {
  return {
    validFrom: iso(temporal.validFrom),
    validUntil: iso(temporal.validUntil),
    precision: temporal.precision,
    condition: temporal.condition,
    timezone: temporal.timezone,
  };
}

export function serializeAgentMemory(memory: IAgentMemory): AgentMemoryWire {
  return {
    id: memory._id.toString(),
    currentRevisionId: memory.currentRevisionId.toString(),
    revision: memory.revision,
    statement: memory.statement,
    memoryType: memory.memoryType,
    status: memory.status,
    explicitness: memory.explicitness,
    confidence: memory.confidence,
    importance: memory.importance,
    trust: memory.trust,
    sensitivity: memory.sensitivity,
    temporal: serializeTemporal(memory.temporal),
    entityRefs: memory.entityRefs,
    evidenceIds: memory.evidenceIds,
    contradictionIds: memory.contradictionIds.map(String),
    supersedesMemoryId: memory.supersedesMemoryId?.toString(),
    pinned: memory.pinned,
    deletedAt: iso(memory.deletedAt),
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export function serializeAgentMemoryCandidate(
  candidate: IAgentMemoryCandidate,
): AgentMemoryCandidateWire {
  return {
    id: candidate._id.toString(),
    statement: candidate.statement,
    memoryType: candidate.memoryType,
    explicitness: candidate.explicitness,
    confidence: candidate.confidence,
    importance: candidate.importance,
    trust: candidate.trust,
    sensitivity: candidate.sensitivity,
    temporal: serializeTemporal(candidate.temporal),
    entityRefs: candidate.entityRefs,
    evidenceIds: candidate.evidenceIds,
    contradictionEvidenceIds: candidate.contradictionEvidenceIds,
    conflictingMemoryIds: candidate.conflictingMemoryIds.map(String),
    extraction: {
      model: candidate.extraction.model,
      promptVersion: candidate.extraction.promptVersion,
      schemaVersion: candidate.extraction.schemaVersion,
      inputHash: candidate.extraction.inputHash,
      runId: candidate.extraction.runId.toString(),
    },
    reason: candidate.reason,
    status: candidate.status,
    reviewFlags:
      candidate.reviewFlags as AgentMemoryCandidateWire["reviewFlags"],
    decidedBy: candidate.decidedBy,
    decidedAt: iso(candidate.decidedAt),
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

export function serializeAgentMemorySettings(
  settings: Pick<
    IAgentMemorySettings,
    | "releaseGates"
    | "gateVerifications"
    | "enabledSources"
    | "excludedSourceRefs"
    | "retrieval"
    | "retention"
    | "reflectionSchedule"
    | "proactivity"
    | "maximumActionAutonomy"
    | "revision"
    | "updatedAt"
  >,
): AgentMemorySettingsWire {
  return {
    id: "singleton",
    releaseGates: settings.releaseGates,
    gateVerifications: Object.fromEntries(
      Object.entries(settings.gateVerifications ?? {}).map(([gate, value]) => [
        gate,
        { ...value, verifiedAt: new Date(value.verifiedAt).toISOString() },
      ]),
    ),
    enabledSources: settings.enabledSources,
    excludedSourceRefs: settings.excludedSourceRefs,
    retrieval: settings.retrieval,
    retention: settings.retention,
    reflectionSchedule: settings.reflectionSchedule,
    proactivity: settings.proactivity,
    maximumActionAutonomy: settings.maximumActionAutonomy,
    revision: settings.revision,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export function serializeAgentRetrievalTrace(
  trace: Pick<
    IAgentRetrievalTrace,
    | "traceId"
    | "conversationId"
    | "requestId"
    | "purpose"
    | "query"
    | "filters"
    | "candidates"
    | "exclusions"
    | "selectedRevisionIds"
    | "tokenBudget"
    | "estimatedTokens"
    | "injected"
    | "abstained"
    | "createdAt"
  >,
) {
  return {
    traceId: trace.traceId,
    conversationId: trace.conversationId?.toString(),
    requestId: trace.requestId,
    purpose: trace.purpose,
    query: trace.query,
    filters: trace.filters,
    candidates: trace.candidates,
    exclusions: trace.exclusions,
    selectedRevisionIds: trace.selectedRevisionIds.map(String),
    tokenBudget: trace.tokenBudget,
    estimatedTokens: trace.estimatedTokens,
    injected: trace.injected,
    abstained: trace.abstained,
    createdAt: trace.createdAt.toISOString(),
  };
}
