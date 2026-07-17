import { z } from "zod";

export const agentMemoryModeSchema = z.enum([
  "enabled",
  "retrieval-off",
  "incognito",
]);
export type AgentMemoryMode = z.infer<typeof agentMemoryModeSchema>;

export const agentSourceTypeSchema = z.enum([
  "conversation",
  "tool-result",
  "feedback",
  "note",
  "calendar",
  "person",
  "project",
  "course",
  "email-triage",
  "journal",
  "file",
  "manual",
]);
export type AgentSourceType = z.infer<typeof agentSourceTypeSchema>;

export const agentActorSchema = z.enum(["user", "agent", "external", "system"]);
export type AgentActor = z.infer<typeof agentActorSchema>;

export const agentTrustSchema = z.enum([
  "highest",
  "high",
  "medium",
  "low",
  "untrusted",
  "derived",
]);
export type AgentTrust = z.infer<typeof agentTrustSchema>;

export const agentSensitivitySchema = z.enum([
  "standard",
  "personal",
  "sensitive",
  "restricted",
  "denied",
]);
export type AgentSensitivity = z.infer<typeof agentSensitivitySchema>;

export const agentExplicitnessSchema = z.enum([
  "explicit",
  "inferred",
  "hypothesis",
]);
export type AgentExplicitness = z.infer<typeof agentExplicitnessSchema>;

export const agentMemoryTypeSchema = z.enum([
  "core",
  "semantic",
  "episodic",
  "reflection",
]);
export type AgentMemoryType = z.infer<typeof agentMemoryTypeSchema>;

export const agentTemporalPrecisionSchema = z.enum([
  "exact",
  "day",
  "month",
  "year",
  "range",
  "unknown",
]);
export type AgentTemporalPrecision = z.infer<
  typeof agentTemporalPrecisionSchema
>;

export const agentMemoryStatusSchema = z.enum([
  "active",
  "superseded",
  "archived",
  "deleted",
]);
export type AgentMemoryStatus = z.infer<typeof agentMemoryStatusSchema>;

export const agentCandidateStatusSchema = z.enum([
  "pending",
  "accepted",
  "dismissed",
  "superseded",
]);
export type AgentCandidateStatus = z.infer<typeof agentCandidateStatusSchema>;

export const agentEntityRefSchema = z.object({
  entityType: z.enum([
    "person",
    "project",
    "course",
    "note",
    "calendar",
    "conversation",
    "journal",
    "kanban",
    "email",
    "other",
  ]),
  entityId: z.string().min(1).max(256),
  label: z.string().trim().min(1).max(256).optional(),
});
export type AgentEntityRef = z.infer<typeof agentEntityRefSchema>;

export const agentSourceRefSchema = z.object({
  entityType: z.string().trim().min(1).max(64),
  entityId: z.string().trim().min(1).max(256),
  revision: z.string().trim().min(1).max(256).optional(),
});
export type AgentSourceRef = z.infer<typeof agentSourceRefSchema>;

const isoDateSchema = z.iso.datetime({ offset: true });

export const agentTemporalSchema = z
  .object({
    validFrom: isoDateSchema.optional(),
    validUntil: isoDateSchema.optional(),
    precision: agentTemporalPrecisionSchema.default("unknown"),
    condition: z.string().trim().max(1_000).optional(),
    timezone: z.string().trim().max(100).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.validFrom &&
      value.validUntil &&
      new Date(value.validUntil) <= new Date(value.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil must be after validFrom",
      });
    }
  });
export type AgentTemporal = z.infer<typeof agentTemporalSchema>;

export const agentEvidenceEventSchema = z.object({
  eventId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(512),
  sourceType: agentSourceTypeSchema,
  sourceRef: agentSourceRefSchema,
  sourceRevision: z.string().trim().max(256).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot: z.string().max(8_192).optional(),
  occurredAt: isoDateSchema,
  observedAt: isoDateSchema,
  timeRange: z
    .object({
      from: isoDateSchema,
      until: isoDateSchema,
      timezone: z.string().trim().max(100).optional(),
    })
    .optional(),
  actor: agentActorSchema,
  trust: agentTrustSchema,
  sensitivity: agentSensitivitySchema,
  memoryEligible: z.boolean(),
  provenance: z.record(z.string(), z.unknown()).default({}),
  redactedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema.optional(),
});
export type AgentEvidenceEvent = z.infer<typeof agentEvidenceEventSchema>;

export const createAgentEvidenceEventSchema = agentEvidenceEventSchema.omit({
  eventId: true,
  observedAt: true,
  redactedAt: true,
  createdAt: true,
});
export type CreateAgentEvidenceEvent = z.infer<
  typeof createAgentEvidenceEventSchema
>;

export const agentMemoryCandidateSchema = z.object({
  id: z.string(),
  statement: z.string().trim().min(1).max(8_192),
  memoryType: agentMemoryTypeSchema,
  explicitness: agentExplicitnessSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  trust: agentTrustSchema,
  sensitivity: agentSensitivitySchema,
  temporal: agentTemporalSchema,
  entityRefs: z.array(agentEntityRefSchema).max(50).default([]),
  evidenceIds: z.array(z.uuid()).min(1).max(100),
  contradictionEvidenceIds: z.array(z.uuid()).max(100).default([]),
  conflictingMemoryIds: z.array(z.string()).max(100).default([]),
  extraction: z.object({
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    runId: z.string(),
  }),
  reason: z.string().trim().min(1).max(4_096),
  status: agentCandidateStatusSchema,
  reviewFlags: z
    .array(
      z.enum([
        "conflict",
        "consolidation",
        "weak-inference",
        "identity-merge",
        "permission-like",
        "policy-change",
        "sensitive",
      ]),
    )
    .default([]),
  decidedBy: z.enum(["user", "policy"]).optional(),
  decidedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentMemoryCandidate = z.infer<typeof agentMemoryCandidateSchema>;

export const agentFormationCandidateSchema = z.object({
  statement: z.string().trim().min(1).max(8_192),
  memoryType: agentMemoryTypeSchema,
  explicitness: agentExplicitnessSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  trust: agentTrustSchema,
  sensitivity: agentSensitivitySchema,
  temporal: agentTemporalSchema,
  entityRefs: z.array(agentEntityRefSchema).max(50).default([]),
  evidenceIds: z.array(z.uuid()).min(1).max(100),
  contradictionEvidenceIds: z.array(z.uuid()).max(100).default([]),
  conflictingMemoryIds: z.array(z.string()).max(100).default([]),
  reason: z.string().trim().min(1).max(4_096),
  reviewFlags: agentMemoryCandidateSchema.shape.reviewFlags,
});
export type AgentFormationCandidate = z.infer<
  typeof agentFormationCandidateSchema
>;

export const agentFormationResultSchema = z.object({
  candidates: z.array(agentFormationCandidateSchema).max(20),
});
export type AgentFormationResult = z.infer<typeof agentFormationResultSchema>;

export const agentConsolidationActionSchema = z.object({
  /**
   * "replace": supersede two or more memories with one surviving statement
   * (duplicates or outdated facts). "rewrite": reword a single memory without
   * changing its meaning (owner-naming cleanup).
   */
  action: z.enum(["replace", "rewrite"]),
  memoryIds: z.array(z.string()).min(1).max(10),
  statement: z.string().trim().min(1).max(8_192),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(4_096),
});
export type AgentConsolidationAction = z.infer<
  typeof agentConsolidationActionSchema
>;

export const agentConsolidationResultSchema = z.object({
  actions: z.array(agentConsolidationActionSchema).max(20),
});
export type AgentConsolidationResult = z.infer<
  typeof agentConsolidationResultSchema
>;

export const agentResourceSuggestionStatusSchema = z.enum([
  "pending",
  "accepted",
  "dismissed",
]);
export type AgentResourceSuggestionStatus = z.infer<
  typeof agentResourceSuggestionStatusSchema
>;

export const agentResourceSuggestionTypeSchema = z.enum(["person"]);
export type AgentResourceSuggestionType = z.infer<
  typeof agentResourceSuggestionTypeSchema
>;

/**
 * A complete person record drafted from memories. The completeness bar is
 * deliberate: a bare first name is not enough to create a person, so the
 * draft requires a full name, how the person relates to the owner, and a
 * notes summary of what the memories establish.
 */
export const agentPersonDraftSchema = z.object({
  name: z.string().trim().min(1).max(256),
  relationToOwner: z.string().trim().min(1).max(1_000),
  notes: z.string().trim().min(1).max(8_192),
  placeMet: z.string().trim().min(1).max(512).optional(),
  email: z.string().trim().min(1).max(320).optional(),
  phone: z.string().trim().min(1).max(64).optional(),
  website: z.string().trim().min(1).max(2_048).optional(),
});
export type AgentPersonDraft = z.infer<typeof agentPersonDraftSchema>;

export const agentResourceSuggestionSchema = z.object({
  id: z.string(),
  resourceType: agentResourceSuggestionTypeSchema,
  entityKey: z.string().min(1).max(512),
  entityLabel: z.string().min(1).max(256),
  draft: agentPersonDraftSchema,
  memoryIds: z.array(z.string()).min(1).max(100),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(4_096),
  existingResourceMatches: z
    .array(z.object({ resourceId: z.string(), name: z.string() }))
    .max(10)
    .default([]),
  status: agentResourceSuggestionStatusSchema,
  model: z.string().min(1).max(200),
  decidedAt: isoDateSchema.optional(),
  resultingResourceId: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentResourceSuggestion = z.infer<
  typeof agentResourceSuggestionSchema
>;

export const agentResourceSuggestionDraftResultSchema = z.object({
  suggestions: z
    .array(
      z.object({
        entityKey: z.string().min(1).max(512),
        draft: agentPersonDraftSchema,
        confidence: z.number().min(0).max(1),
        reason: z.string().trim().min(1).max(4_096),
      }),
    )
    .max(10),
});
export type AgentResourceSuggestionDraftResult = z.infer<
  typeof agentResourceSuggestionDraftResultSchema
>;

export const generateAgentResourceSuggestionsSchema = z.object({
  entityKey: z.string().trim().min(1).max(512).optional(),
  model: z.string().trim().min(1).max(200).optional(),
});
export type GenerateAgentResourceSuggestions = z.infer<
  typeof generateAgentResourceSuggestionsSchema
>;

export const agentResourceSuggestionDecisionSchema = z.object({
  action: z.enum(["accept", "dismiss"]),
  reason: z.string().trim().min(1).max(2_000),
  draft: agentPersonDraftSchema.partial().optional(),
});
export type AgentResourceSuggestionDecision = z.infer<
  typeof agentResourceSuggestionDecisionSchema
>;

export const agentResourceSuggestionListResponseSchema = z.object({
  suggestions: z.array(agentResourceSuggestionSchema),
  stats: z.object({
    pending: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});
export type AgentResourceSuggestionListResponse = z.infer<
  typeof agentResourceSuggestionListResponseSchema
>;

export const generateAgentResourceSuggestionsResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  suggestions: z.array(agentResourceSuggestionSchema),
});
export type GenerateAgentResourceSuggestionsResponse = z.infer<
  typeof generateAgentResourceSuggestionsResponseSchema
>;

export const agentMemoryRevisionSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  revision: z.number().int().positive(),
  statement: z.string().trim().min(1).max(8_192),
  memoryType: agentMemoryTypeSchema,
  status: agentMemoryStatusSchema,
  explicitness: agentExplicitnessSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  trust: agentTrustSchema,
  sensitivity: agentSensitivitySchema,
  temporal: agentTemporalSchema,
  entityRefs: z.array(agentEntityRefSchema).max(50),
  evidenceIds: z.array(z.uuid()).min(1).max(100),
  contradictionIds: z.array(z.string()).max(100),
  supersedesMemoryId: z.string().optional(),
  createdBy: z.enum(["user", "agent", "policy", "rollback"]),
  decisionReason: z.string().trim().min(1).max(4_096),
  createdAt: isoDateSchema,
});
export type AgentMemoryRevision = z.infer<typeof agentMemoryRevisionSchema>;

export const agentMemorySchema = z.object({
  id: z.string(),
  currentRevisionId: z.string(),
  revision: z.number().int().positive(),
  statement: z.string().trim().min(1).max(8_192),
  memoryType: agentMemoryTypeSchema,
  status: agentMemoryStatusSchema,
  explicitness: agentExplicitnessSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  trust: agentTrustSchema,
  sensitivity: agentSensitivitySchema,
  temporal: agentTemporalSchema,
  entityRefs: z.array(agentEntityRefSchema).max(50),
  evidenceIds: z.array(z.uuid()).min(1).max(100),
  contradictionIds: z.array(z.string()).max(100),
  supersedesMemoryId: z.string().optional(),
  pinned: z.boolean().default(false),
  deletedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentMemory = z.infer<typeof agentMemorySchema>;

export const agentGoalStatusSchema = z.enum([
  "suggested",
  "active",
  "paused",
  "completed",
  "abandoned",
]);
export const agentGoalSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(512),
  description: z.string().max(4_096).optional(),
  kind: z.enum(["goal", "user-commitment", "agent-follow-up"]),
  status: agentGoalStatusSchema,
  motivation: z.string().max(2_000).optional(),
  targetFrom: isoDateSchema.optional(),
  targetUntil: isoDateSchema.optional(),
  constraints: z.array(z.string().max(1_000)).max(50),
  dependencyIds: z.array(z.string()).max(100),
  progressEvidenceIds: z.array(z.uuid()).max(100),
  relatedEntities: z.array(agentEntityRefSchema).max(50),
  pauseOrAbandonReason: z.string().max(2_000).optional(),
  provenance: agentSourceRefSchema,
  revision: z.number().int().positive(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentGoal = z.infer<typeof agentGoalSchema>;

export const createAgentGoalSchema = agentGoalSchema
  .pick({
    title: true,
    description: true,
    kind: true,
    motivation: true,
    targetFrom: true,
    targetUntil: true,
    constraints: true,
    dependencyIds: true,
    progressEvidenceIds: true,
    relatedEntities: true,
  })
  .extend({
    status: agentGoalStatusSchema.default("active"),
  });
export type CreateAgentGoal = z.infer<typeof createAgentGoalSchema>;
export const updateAgentGoalSchema = createAgentGoalSchema.partial().extend({
  pauseOrAbandonReason: z.string().trim().min(1).max(2_000).optional(),
  reason: z.string().trim().min(1).max(2_000),
});
export type UpdateAgentGoal = z.infer<typeof updateAgentGoalSchema>;

export const agentProcedureLifecycleSchema = z.enum([
  "candidate",
  "testing",
  "active",
  "retired",
]);
export const agentProcedureSchema = z.object({
  id: z.string(),
  lifecycle: agentProcedureLifecycleSchema,
  scope: z.string().trim().min(1).max(1_000),
  trigger: z.string().trim().min(1).max(2_000),
  behavior: z.string().trim().min(1).max(4_096),
  exceptions: z.array(z.string().max(1_000)).max(50),
  supportingFeedbackIds: z.array(z.string()).max(100),
  evidenceIds: z.array(z.uuid()).max(100),
  confidence: z.number().min(0).max(1),
  explicit: z.boolean(),
  promotionReason: z.string().max(2_000).optional(),
  retirementReason: z.string().max(2_000).optional(),
  revision: z.number().int().positive(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentProcedure = z.infer<typeof agentProcedureSchema>;

export const createAgentProcedureSchema = agentProcedureSchema
  .pick({
    scope: true,
    trigger: true,
    behavior: true,
    exceptions: true,
    supportingFeedbackIds: true,
    evidenceIds: true,
    confidence: true,
    explicit: true,
  })
  .extend({ lifecycle: agentProcedureLifecycleSchema.optional() });
export type CreateAgentProcedure = z.infer<typeof createAgentProcedureSchema>;
export const updateAgentProcedureSchema = createAgentProcedureSchema
  .partial()
  .extend({
    lifecycle: agentProcedureLifecycleSchema.optional(),
    reason: z.string().trim().min(1).max(2_000),
  });
export type UpdateAgentProcedure = z.infer<typeof updateAgentProcedureSchema>;

export const agentUserModelChunkSchema = z.object({
  key: z.string().min(1).max(256),
  statement: z.string().min(1).max(8_192),
  evidenceIds: z.array(z.uuid()).max(100),
  memoryIds: z.array(z.string()).max(100),
  confidence: z.number().min(0).max(1),
  explicitness: agentExplicitnessSchema,
  sensitivity: agentSensitivitySchema.exclude(["denied"]),
  validFrom: isoDateSchema.optional(),
  validUntil: isoDateSchema.optional(),
  lastConfirmedAt: isoDateSchema.optional(),
});
export const agentUserModelSchema = z.object({
  id: z.literal("singleton"),
  currentRevisionId: z.string(),
  revision: z.number().int().positive(),
  sections: z.record(z.string(), z.array(agentUserModelChunkSchema)),
  sourceMemoryRevision: z.number().int().nonnegative(),
  generatedAt: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentUserModel = z.infer<typeof agentUserModelSchema>;

export const agentUserModelRevisionSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  sections: z.record(z.string(), z.array(agentUserModelChunkSchema)),
  sourceMemoryRevision: z.number().int().nonnegative(),
  changedMemoryIds: z.array(z.string()),
  reason: z.string(),
  createdBy: z.enum(["user", "policy", "reflection", "rollback"]),
  createdAt: isoDateSchema,
});
export type AgentUserModelRevision = z.infer<
  typeof agentUserModelRevisionSchema
>;

export const agentMemoryRunSchema = z.object({
  id: z.string(),
  operation: z.enum([
    "formation",
    "consolidation",
    "reflection",
    "evaluation",
    "backfill",
    "insight",
    "resource-suggestion",
  ]),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  model: z.string().optional(),
  promptVersion: z.string(),
  schemaVersion: z.string(),
  inputIds: z.array(z.string()),
  outputIds: z.array(z.string()),
  usage: z
    .object({
      inputTokens: z.number().nonnegative(),
      outputTokens: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
    })
    .optional(),
  error: z.string().optional(),
  startedAt: isoDateSchema,
  completedAt: isoDateSchema.optional(),
});
export type AgentMemoryRun = z.infer<typeof agentMemoryRunSchema>;

export const agentReflectionOverviewSchema = z.object({
  goals: z.array(agentGoalSchema),
  procedures: z.array(agentProcedureSchema),
  runs: z.array(agentMemoryRunSchema),
  userModel: agentUserModelSchema.nullable(),
  revisions: z.array(agentUserModelRevisionSchema),
});
export type AgentReflectionOverview = z.infer<
  typeof agentReflectionOverviewSchema
>;

export const rollbackAgentUserModelSchema = z.object({
  targetRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2_000),
});

export const agentRetrievalTraceSchema = z.object({
  traceId: z.uuid(),
  conversationId: z.string().optional(),
  requestId: z.string().optional(),
  purpose: z.string(),
  query: z.string(),
  filters: z.record(z.string(), z.unknown()),
  candidates: z.array(z.record(z.string(), z.unknown())),
  exclusions: z.array(z.record(z.string(), z.unknown())),
  selectedRevisionIds: z.array(z.string()),
  tokenBudget: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  injected: z.boolean(),
  abstained: z.boolean(),
  createdAt: isoDateSchema,
});
export type AgentRetrievalTrace = z.infer<typeof agentRetrievalTraceSchema>;

export const agentRetrievalTraceListResponseSchema = z.object({
  traces: z.array(agentRetrievalTraceSchema),
});

export const agentRetrievalTraceResponseSchema = z.object({
  trace: agentRetrievalTraceSchema,
});

export const agentReleaseGatesSchema = z.object({
  evidenceLedger: z.boolean(),
  formation: z.boolean(),
  shadowRetrieval: z.boolean(),
  chatMemory: z.boolean(),
  reflection: z.boolean(),
  proactivity: z.boolean(),
});
export type AgentReleaseGates = z.infer<typeof agentReleaseGatesSchema>;

export const agentReleaseGateNameSchema = z.enum([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
]);
export type AgentReleaseGateName = z.infer<typeof agentReleaseGateNameSchema>;

export const agentGateVerificationSchema = z.object({
  verifiedAt: isoDateSchema,
  verifiedBy: z.literal("owner"),
  sampleSize: z.number().int().nonnegative(),
  hardGatesPassed: z.boolean(),
  notes: z.string().trim().min(1).max(4_096),
  metrics: z.record(z.string(), z.number()).default({}),
});
export type AgentGateVerification = z.infer<typeof agentGateVerificationSchema>;

export const agentMemorySettingsSchema = z.object({
  id: z.literal("singleton"),
  releaseGates: agentReleaseGatesSchema,
  gateVerifications: z.partialRecord(
    agentReleaseGateNameSchema,
    agentGateVerificationSchema,
  ),
  enabledSources: z.array(agentSourceTypeSchema),
  excludedSourceRefs: z.array(agentSourceRefSchema),
  retrieval: z.object({
    maxCoreItems: z.number().int().min(0).max(20),
    maxRetrievedItems: z.number().int().min(0).max(50),
    maxTokens: z.number().int().min(0).max(10_000),
    embeddingModel: z.string().nullable(),
    embeddingDimensions: z.number().int().positive().max(4_096).nullable(),
    vectorIndex: z.string().nullable(),
    /** Cheap model that maintains each conversation's rolling retrieval-query
     *  summary; null disables the summary and retrieval uses only the latest
     *  message. */
    querySummaryModel: z.string().nullable(),
  }),
  retention: z.object({
    terminalJobDays: z.number().int().min(1).max(365),
    retrievalTraceDays: z.number().int().min(1).max(365),
  }),
  reflectionSchedule: z.string().nullable(),
  proactivity: z.object({
    enabledCategories: z.array(z.string()),
    maxInsightsPerDay: z.number().int().min(0).max(100),
    externalDelivery: z.boolean(),
  }),
  promotion: z.object({
    mode: z.enum(["conservative", "single-user"]),
    emailReviewMaxConfidence: z.number().min(0).max(1),
  }),
  consolidation: z.object({
    enabled: z.boolean(),
    autoApplyThreshold: z.number().min(0).max(1),
    batchSize: z.number().int().min(1).max(100),
  }),
  resourceSuggestions: z.object({
    enabled: z.boolean(),
    model: z.string().trim().min(1).max(200).nullable(),
  }),
  formationModel: z.string().trim().min(1).max(200).nullable(),
  maximumActionAutonomy: z.literal("prepare-only"),
  revision: z.number().int().positive(),
  updatedAt: isoDateSchema,
});
export type AgentMemorySettings = z.infer<typeof agentMemorySettingsSchema>;
export type AgentPromotionPolicy = AgentMemorySettings["promotion"];

export const updateAgentMemorySettingsSchema = agentMemorySettingsSchema
  .pick({
    enabledSources: true,
    excludedSourceRefs: true,
    retrieval: true,
    retention: true,
    reflectionSchedule: true,
    proactivity: true,
    promotion: true,
    consolidation: true,
    resourceSuggestions: true,
    formationModel: true,
    maximumActionAutonomy: true,
  })
  .partial();
export type UpdateAgentMemorySettings = z.infer<
  typeof updateAgentMemorySettingsSchema
>;

export const setAgentReleaseGateSchema = z.object({
  gate: agentReleaseGateNameSchema,
  enabled: z.boolean(),
  verification: agentGateVerificationSchema.optional(),
});
export type SetAgentReleaseGate = z.infer<typeof setAgentReleaseGateSchema>;

export const agentMemorySortSchema = z.enum([
  "importance",
  "confidence",
  "recent",
]);
export type AgentMemorySort = z.infer<typeof agentMemorySortSchema>;

export const agentCandidateSortSchema = z.enum(["confidence", "recent"]);
export type AgentCandidateSort = z.infer<typeof agentCandidateSortSchema>;

export const bulkAgentCandidateDecisionSchema = z.object({
  action: z.enum(["accept", "dismiss"]),
  candidateIds: z.array(z.string()).min(1).max(100),
  reason: z.string().trim().min(1).max(2_000),
});
export type BulkAgentCandidateDecision = z.infer<
  typeof bulkAgentCandidateDecisionSchema
>;

export const bulkAgentCandidateDecisionResponseSchema = z.object({
  succeeded: z.number().int().nonnegative(),
  failed: z.array(z.object({ candidateId: z.string(), error: z.string() })),
});
export type BulkAgentCandidateDecisionResponse = z.infer<
  typeof bulkAgentCandidateDecisionResponseSchema
>;

export const agentMemoryDecisionSchema = z.object({
  action: z.enum([
    "accept",
    "dismiss",
    "archive",
    "supersede",
    "rollback",
    "delete",
    "resolve-contradiction",
  ]),
  statement: z.string().trim().min(1).max(8_192).optional(),
  reason: z.string().trim().min(1).max(2_000),
  targetMemoryId: z.string().optional(),
  targetRevision: z.number().int().positive().optional(),
});
export type AgentMemoryDecision = z.infer<typeof agentMemoryDecisionSchema>;

export const agentMemoryFeedbackKindSchema = z.enum([
  "useful",
  "not-relevant",
  "forget",
  "correction",
]);
export type AgentMemoryFeedbackKind = z.infer<
  typeof agentMemoryFeedbackKindSchema
>;

export const createAgentMemoryFeedbackSchema = z
  .object({
    feedbackId: z.uuid(),
    kind: agentMemoryFeedbackKindSchema,
    memoryId: z.string().optional(),
    correction: z.string().trim().min(1).max(8_192).optional(),
  })
  .superRefine((value, context) => {
    if (["forget", "correction"].includes(value.kind) && !value.memoryId) {
      context.addIssue({
        code: "custom",
        path: ["memoryId"],
        message: `${value.kind} feedback requires a memoryId`,
      });
    }
    if (value.kind === "correction" && !value.correction) {
      context.addIssue({
        code: "custom",
        path: ["correction"],
        message: "Correction feedback requires replacement text",
      });
    }
  });
export type CreateAgentMemoryFeedback = z.infer<
  typeof createAgentMemoryFeedbackSchema
>;

export const agentMemoryFeedbackResponseSchema = z.object({
  feedbackId: z.uuid(),
  kind: agentMemoryFeedbackKindSchema,
  memoryIds: z.array(z.string()),
  resultingMemoryId: z.string().optional(),
});
export type AgentMemoryFeedbackResponse = z.infer<
  typeof agentMemoryFeedbackResponseSchema
>;

export const AGENT_INSIGHT_CATEGORIES = [
  "goal-deadline",
  "calendar-conflict",
  "follow-up",
  "memory-contradiction",
  "repeated-failure",
  "daily-briefing",
] as const;
export const agentInsightCategorySchema = z.enum(AGENT_INSIGHT_CATEGORIES);
export type AgentInsightCategory = z.infer<typeof agentInsightCategorySchema>;

export const agentInsightStatusSchema = z.enum([
  "pending",
  "delivered",
  "dismissed",
  "snoozed",
  "expired",
]);
export type AgentInsightStatus = z.infer<typeof agentInsightStatusSchema>;

export const agentInsightDeliverySchema = z.enum(["in-app", "silent-draft"]);
export type AgentInsightDelivery = z.infer<typeof agentInsightDeliverySchema>;

export const agentInsightSchema = z.object({
  id: z.string(),
  idempotencyKey: z.string().min(1).max(512),
  category: z.string().min(1).max(100),
  status: agentInsightStatusSchema,
  title: z.string().min(1).max(512),
  body: z.string().min(1).max(4_096),
  triggerEvidenceIds: z.array(z.string()).max(100),
  reason: z.string().min(1).max(2_000),
  proposedAction: z.record(z.string(), z.unknown()).optional(),
  expectedUsefulness: z.number().min(0).max(1),
  urgency: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  interruptionCost: z.number().min(0).max(1),
  delivery: agentInsightDeliverySchema,
  expiresAt: isoDateSchema,
  snoozedUntil: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentInsight = z.infer<typeof agentInsightSchema>;

export const agentInsightActionSchema = z
  .object({
    action: z.enum(["dismiss", "snooze", "useful", "delivered"]),
    snoozedUntil: isoDateSchema.optional(),
    reason: z.string().trim().min(1).max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === "snooze" && !value.snoozedUntil) {
      context.addIssue({
        code: "custom",
        path: ["snoozedUntil"],
        message: "Snooze requires a snoozedUntil timestamp",
      });
    }
  });
export type AgentInsightAction = z.infer<typeof agentInsightActionSchema>;

export const agentInsightListResponseSchema = z.object({
  insights: z.array(agentInsightSchema),
  stats: z.object({
    pending: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    snoozed: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
  }),
});
export type AgentInsightListResponse = z.infer<
  typeof agentInsightListResponseSchema
>;

export const agentMemoryListResponseSchema = z.object({
  memories: z.array(agentMemorySchema),
  candidates: z.array(agentMemoryCandidateSchema),
  totalMemories: z.number().int().nonnegative(),
  totalCandidates: z.number().int().nonnegative(),
  pendingCandidates: z.number().int().nonnegative(),
  memoryPage: z.number().int().positive(),
  candidatePage: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  settings: agentMemorySettingsSchema,
});
export type AgentMemoryListResponse = z.infer<
  typeof agentMemoryListResponseSchema
>;

export const agentMemoryContradictionGroupSchema = z.object({
  memory: agentMemorySchema,
  conflicts: z.array(agentMemorySchema),
});
export type AgentMemoryContradictionGroup = z.infer<
  typeof agentMemoryContradictionGroupSchema
>;

export const agentMemoryContradictionListResponseSchema = z.object({
  groups: z.array(agentMemoryContradictionGroupSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type AgentMemoryContradictionListResponse = z.infer<
  typeof agentMemoryContradictionListResponseSchema
>;

export const agentMemoryGraphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["memory", "entity"]),
  label: z.string().max(200),
  memoryType: agentMemoryTypeSchema.optional(),
  status: agentMemoryStatusSchema.optional(),
  entityType: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  hasEmbedding: z.boolean().optional(),
  count: z.number().int().nonnegative().optional(),
  isOwner: z.boolean().optional(),
});
export type AgentMemoryGraphNode = z.infer<typeof agentMemoryGraphNodeSchema>;

export const agentMemoryGraphLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(["entity", "similar", "contradiction", "supersession"]),
  strength: z.number().min(0).max(1),
});
export type AgentMemoryGraphLink = z.infer<typeof agentMemoryGraphLinkSchema>;

export const agentMemoryGraphResponseSchema = z.object({
  nodes: z.array(agentMemoryGraphNodeSchema),
  links: z.array(agentMemoryGraphLinkSchema),
  embeddedCount: z.number().int().nonnegative(),
  generatedAt: isoDateSchema,
});
export type AgentMemoryGraphResponse = z.infer<
  typeof agentMemoryGraphResponseSchema
>;
