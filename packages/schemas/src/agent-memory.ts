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

const isoDateSchema = z.string().datetime({ offset: true });

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
  eventId: z.string().uuid(),
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
  evidenceIds: z.array(z.string().uuid()).min(1).max(100),
  contradictionEvidenceIds: z.array(z.string().uuid()).max(100).default([]),
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
  evidenceIds: z.array(z.string().uuid()).min(1).max(100),
  contradictionEvidenceIds: z.array(z.string().uuid()).max(100).default([]),
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
  evidenceIds: z.array(z.string().uuid()).min(1).max(100),
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
  evidenceIds: z.array(z.string().uuid()).min(1).max(100),
  contradictionIds: z.array(z.string()).max(100),
  supersedesMemoryId: z.string().optional(),
  pinned: z.boolean().default(false),
  deletedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentMemory = z.infer<typeof agentMemorySchema>;

export const agentRetrievalTraceSchema = z.object({
  traceId: z.string().uuid(),
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
  maximumActionAutonomy: z.literal("prepare-only"),
  revision: z.number().int().positive(),
  updatedAt: isoDateSchema,
});
export type AgentMemorySettings = z.infer<typeof agentMemorySettingsSchema>;

export const updateAgentMemorySettingsSchema = agentMemorySettingsSchema
  .pick({
    enabledSources: true,
    excludedSourceRefs: true,
    retrieval: true,
    retention: true,
    reflectionSchedule: true,
    proactivity: true,
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

export const agentMemoryDecisionSchema = z.object({
  action: z.enum([
    "accept",
    "dismiss",
    "archive",
    "supersede",
    "rollback",
    "delete",
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
    feedbackId: z.string().uuid(),
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
  feedbackId: z.string().uuid(),
  kind: agentMemoryFeedbackKindSchema,
  memoryIds: z.array(z.string()),
  resultingMemoryId: z.string().optional(),
});
export type AgentMemoryFeedbackResponse = z.infer<
  typeof agentMemoryFeedbackResponseSchema
>;

export const agentMemoryListResponseSchema = z.object({
  memories: z.array(agentMemorySchema),
  candidates: z.array(agentMemoryCandidateSchema),
  totalMemories: z.number().int().nonnegative(),
  pendingCandidates: z.number().int().nonnegative(),
  settings: agentMemorySettingsSchema,
});
export type AgentMemoryListResponse = z.infer<
  typeof agentMemoryListResponseSchema
>;
