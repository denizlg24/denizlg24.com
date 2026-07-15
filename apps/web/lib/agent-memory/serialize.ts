import type {
  AgentGoal as AgentGoalWire,
  AgentInsight as AgentInsightWire,
  AgentMemoryCandidate as AgentMemoryCandidateWire,
  AgentMemoryRun as AgentMemoryRunWire,
  AgentMemorySettings as AgentMemorySettingsWire,
  AgentMemory as AgentMemoryWire,
  AgentProcedure as AgentProcedureWire,
  AgentResourceSuggestion as AgentResourceSuggestionWire,
  AgentUserModelRevision as AgentUserModelRevisionWire,
  AgentUserModel as AgentUserModelWire,
} from "@repo/schemas";
import type { IAgentGoal } from "@/models/AgentGoal";
import type { IAgentInsight } from "@/models/AgentInsight";
import type { IAgentMemory } from "@/models/AgentMemory";
import type { IAgentMemoryCandidate } from "@/models/AgentMemoryCandidate";
import type { IAgentMemoryRun } from "@/models/AgentMemoryRun";
import type { IAgentMemorySettings } from "@/models/AgentMemorySettings";
import type { IAgentProcedure } from "@/models/AgentProcedure";
import type { IAgentResourceSuggestion } from "@/models/AgentResourceSuggestion";
import type { IAgentRetrievalTrace } from "@/models/AgentRetrievalTrace";
import type { IAgentUserModel } from "@/models/AgentUserModel";
import type { IAgentUserModelRevision } from "@/models/AgentUserModelRevision";

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

function serializeSections(
  sections: IAgentUserModel["sections"] | IAgentUserModelRevision["sections"],
) {
  return Object.fromEntries(
    Object.entries(sections).map(([section, chunks]) => [
      section,
      chunks.map((chunk) => ({
        ...chunk,
        memoryIds: chunk.memoryIds.map(String),
        validFrom: iso(chunk.validFrom),
        validUntil: iso(chunk.validUntil),
        lastConfirmedAt: iso(chunk.lastConfirmedAt),
      })),
    ]),
  );
}

export function serializeAgentGoal(goal: IAgentGoal): AgentGoalWire {
  return {
    id: goal._id.toString(),
    title: goal.title,
    description: goal.description,
    kind: goal.kind,
    status: goal.status,
    motivation: goal.motivation,
    targetFrom: iso(goal.targetFrom),
    targetUntil: iso(goal.targetUntil),
    constraints: goal.constraints,
    dependencyIds: goal.dependencyIds.map(String),
    progressEvidenceIds: goal.progressEvidenceIds,
    relatedEntities: goal.relatedEntities as AgentGoalWire["relatedEntities"],
    pauseOrAbandonReason: goal.pauseOrAbandonReason,
    provenance: goal.provenance as AgentGoalWire["provenance"],
    revision: goal.revision,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export function serializeAgentInsight(
  insight: IAgentInsight,
): AgentInsightWire {
  return {
    id: insight._id.toString(),
    idempotencyKey: insight.idempotencyKey,
    category: insight.category,
    status: insight.status,
    title: insight.title,
    body: insight.body,
    triggerEvidenceIds: insight.triggerEvidenceIds,
    reason: insight.reason,
    proposedAction: insight.proposedAction,
    expectedUsefulness: insight.expectedUsefulness,
    urgency: insight.urgency,
    confidence: insight.confidence,
    interruptionCost: insight.interruptionCost,
    delivery: insight.delivery,
    expiresAt: insight.expiresAt.toISOString(),
    snoozedUntil: iso(insight.snoozedUntil),
    createdAt: insight.createdAt.toISOString(),
    updatedAt: insight.updatedAt.toISOString(),
  };
}

export function serializeAgentProcedure(
  procedure: IAgentProcedure,
): AgentProcedureWire {
  return {
    id: procedure._id.toString(),
    lifecycle: procedure.lifecycle,
    scope: procedure.scope,
    trigger: procedure.trigger,
    behavior: procedure.behavior,
    exceptions: procedure.exceptions,
    supportingFeedbackIds: procedure.supportingFeedbackIds.map(String),
    evidenceIds: procedure.evidenceIds,
    confidence: procedure.confidence,
    explicit: procedure.explicit,
    promotionReason: procedure.promotionReason,
    retirementReason: procedure.retirementReason,
    revision: procedure.revision,
    createdAt: procedure.createdAt.toISOString(),
    updatedAt: procedure.updatedAt.toISOString(),
  };
}

export function serializeAgentMemoryRun(
  run: IAgentMemoryRun & { _id: unknown },
): AgentMemoryRunWire {
  const usage = run.usage;
  const serializedUsage =
    usage &&
    Number.isFinite(usage.inputTokens) &&
    Number.isFinite(usage.outputTokens) &&
    Number.isFinite(usage.costUsd)
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        }
      : undefined;
  return {
    id: String(run._id),
    operation: run.operation,
    status: run.status,
    model: run.model,
    promptVersion: run.promptVersion,
    schemaVersion: run.schemaVersion,
    inputIds: run.inputIds,
    outputIds: run.outputIds,
    usage: serializedUsage,
    error: run.error,
    startedAt: new Date(run.startedAt).toISOString(),
    completedAt: iso(run.completedAt),
  };
}

export function serializeAgentUserModel(
  model: IAgentUserModel,
): AgentUserModelWire {
  return {
    id: "singleton",
    currentRevisionId: model.currentRevisionId.toString(),
    revision: model.revision,
    sections: serializeSections(model.sections),
    sourceMemoryRevision: model.sourceMemoryRevision,
    generatedAt: model.generatedAt.toISOString(),
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  } as AgentUserModelWire;
}

export function serializeAgentUserModelRevision(
  revision: IAgentUserModelRevision,
): AgentUserModelRevisionWire {
  return {
    id: revision._id.toString(),
    revision: revision.revision,
    sections: serializeSections(revision.sections),
    sourceMemoryRevision: revision.sourceMemoryRevision,
    changedMemoryIds: revision.changedMemoryIds.map(String),
    reason: revision.reason,
    createdBy: revision.createdBy,
    createdAt: revision.createdAt.toISOString(),
  } as AgentUserModelRevisionWire;
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

export function serializeAgentResourceSuggestion(
  suggestion: IAgentResourceSuggestion,
): AgentResourceSuggestionWire {
  return {
    id: suggestion._id.toString(),
    resourceType: suggestion.resourceType,
    entityKey: suggestion.entityKey,
    entityLabel: suggestion.entityLabel,
    draft: {
      name: suggestion.draft.name,
      relationToOwner: suggestion.draft.relationToOwner,
      notes: suggestion.draft.notes,
      placeMet: suggestion.draft.placeMet,
      email: suggestion.draft.email,
      phone: suggestion.draft.phone,
      website: suggestion.draft.website,
    },
    memoryIds: suggestion.memoryIds.map(String),
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    existingResourceMatches: suggestion.existingResourceMatches.map(
      (match) => ({ resourceId: match.resourceId, name: match.name }),
    ),
    status: suggestion.status,
    model: suggestion.model,
    decidedAt: iso(suggestion.decidedAt),
    resultingResourceId: suggestion.resultingResourceId,
    createdAt: suggestion.createdAt.toISOString(),
    updatedAt: suggestion.updatedAt.toISOString(),
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
    | "promotion"
    | "consolidation"
    | "resourceSuggestions"
    | "formationModel"
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
    promotion: settings.promotion,
    consolidation: settings.consolidation,
    resourceSuggestions: settings.resourceSuggestions,
    formationModel: settings.formationModel,
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
