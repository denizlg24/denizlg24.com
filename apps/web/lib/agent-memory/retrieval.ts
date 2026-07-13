import { randomUUID } from "node:crypto";
import type {
  AgentExplicitness,
  AgentMemoryMode,
  AgentMemoryStatus,
  AgentMemoryType,
  AgentSensitivity,
  AgentTrust,
} from "@repo/schemas";
import mongoose from "mongoose";
import { embedText } from "@/lib/llm-service";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentRetrievalTrace } from "@/models/AgentRetrievalTrace";
import { sourceRefIsExcluded } from "./policy";
import { findDeniedContent } from "./security";
import { getAgentMemorySettings } from "./settings";
import { AGENT_MEMORY_VECTOR_CONFIG } from "./vector-config";

const RETRIEVABLE_SENSITIVITIES: AgentSensitivity[] = [
  "standard",
  "personal",
  "sensitive",
  "restricted",
];
const MINIMUM_RETRIEVAL_SCORE = 0.3;

const TRUST_SCORE: Record<AgentTrust, number> = {
  highest: 1,
  high: 0.9,
  medium: 0.7,
  low: 0.45,
  untrusted: 0.25,
  derived: 0.6,
};

const EXPLICITNESS_SCORE: Record<AgentExplicitness, number> = {
  explicit: 1,
  inferred: 0.7,
  hypothesis: 0.35,
};

export interface RetrievalMemory {
  id: string;
  revisionId: string;
  statement: string;
  memoryType: AgentMemoryType;
  status: AgentMemoryStatus;
  explicitness: AgentExplicitness;
  confidence: number;
  importance: number;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  validFrom?: Date;
  validUntil?: Date;
  evidenceIds: string[];
  contradictionIds: string[];
  pinned: boolean;
  updatedAt: Date;
}

export interface RetrievalSignals {
  vector?: number;
  lexical?: number;
  structured?: number;
  entityProximity?: number;
  activeGoal?: number;
}

export interface RetrievalScoreComponents {
  vector: number;
  lexical: number;
  structured: number;
  importance: number;
  confidence: number;
  trust: number;
  explicitness: number;
  recency: number;
  coreBoost: number;
  pinnedBoost: number;
  entityBoost: number;
  goalBoost: number;
  conflictPenalty: number;
  hypothesisPenalty: number;
}

export interface RankedRetrievalCandidate {
  memory: RetrievalMemory;
  score: number;
  estimatedTokens: number;
  components: RetrievalScoreComponents;
  reasons: string[];
}

export interface RetrievalExclusion {
  memoryId?: string;
  source?: "structured" | "lexical" | "vector" | "evidence";
  reason: string;
}

function clampScore(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 0));
}

function recencyScore(updatedAt: Date, now: Date): number {
  const ageDays = Math.max(0, now.getTime() - updatedAt.getTime()) / 86_400_000;
  return Math.exp(-ageDays / 180);
}

export function estimateMemoryTokens(statement: string): number {
  return Math.max(1, Math.ceil(statement.length / 4) + 12);
}

export function scoreRetrievalCandidate(
  memory: RetrievalMemory,
  signals: RetrievalSignals,
  now = new Date(),
): RankedRetrievalCandidate {
  const components: RetrievalScoreComponents = {
    vector: clampScore(signals.vector) * 0.42,
    lexical: clampScore(signals.lexical) * 0.2,
    structured: clampScore(signals.structured) * 0.1,
    importance: clampScore(memory.importance) * 0.07,
    confidence: clampScore(memory.confidence) * 0.06,
    trust: TRUST_SCORE[memory.trust] * 0.04,
    explicitness: EXPLICITNESS_SCORE[memory.explicitness] * 0.03,
    recency: recencyScore(memory.updatedAt, now) * 0.03,
    coreBoost: memory.memoryType === "core" ? 0.06 : 0,
    pinnedBoost: memory.pinned ? 0.05 : 0,
    entityBoost: clampScore(signals.entityProximity) * 0.04,
    goalBoost: clampScore(signals.activeGoal) * 0.05,
    conflictPenalty: memory.contradictionIds.length > 0 ? 0.18 : 0,
    hypothesisPenalty: memory.explicitness === "hypothesis" ? 0.12 : 0,
  };
  const positive =
    components.vector +
    components.lexical +
    components.structured +
    components.importance +
    components.confidence +
    components.trust +
    components.explicitness +
    components.recency +
    components.coreBoost +
    components.pinnedBoost +
    components.entityBoost +
    components.goalBoost;
  const score = clampScore(
    positive - components.conflictPenalty - components.hypothesisPenalty,
  );
  const reasons = Object.entries(components)
    .filter(([, value]) => value > 0)
    .map(([name]) => name);
  return {
    memory,
    score,
    estimatedTokens: estimateMemoryTokens(memory.statement),
    components,
    reasons,
  };
}

export function hardFilterMemory(
  memory: RetrievalMemory,
  options: {
    now?: Date;
    allowedSensitivities?: AgentSensitivity[];
  } = {},
): string | null {
  const now = options.now ?? new Date();
  const allowed = options.allowedSensitivities ?? RETRIEVABLE_SENSITIVITIES;
  if (memory.status !== "active") return `status:${memory.status}`;
  if (!allowed.includes(memory.sensitivity)) {
    return `sensitivity:${memory.sensitivity}`;
  }
  if (memory.validFrom && memory.validFrom > now) return "not-yet-valid";
  if (memory.validUntil && memory.validUntil <= now) return "expired";
  if (memory.evidenceIds.length === 0) return "missing-provenance";
  return null;
}

export function rankAndBudgetRetrieval(
  inputs: { memory: RetrievalMemory; signals: RetrievalSignals }[],
  options: {
    maxItems: number;
    maxTokens: number;
    now?: Date;
    allowedSensitivities?: AgentSensitivity[];
    minimumScore?: number;
  },
): {
  candidates: RankedRetrievalCandidate[];
  selected: RankedRetrievalCandidate[];
  exclusions: RetrievalExclusion[];
  estimatedTokens: number;
} {
  const exclusions: RetrievalExclusion[] = [];
  const seenRevisions = new Set<string>();
  const candidates = inputs
    .flatMap(({ memory, signals }) => {
      const exclusion = hardFilterMemory(memory, options);
      if (exclusion) {
        exclusions.push({ memoryId: memory.id, reason: exclusion });
        return [];
      }
      if (seenRevisions.has(memory.revisionId)) {
        exclusions.push({ memoryId: memory.id, reason: "duplicate-revision" });
        return [];
      }
      seenRevisions.add(memory.revisionId);
      return [scoreRetrievalCandidate(memory, signals, options.now)];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.memory.importance - left.memory.importance ||
        left.memory.id.localeCompare(right.memory.id),
    );

  const selected: RankedRetrievalCandidate[] = [];
  let estimatedTokens = 0;
  const minimumScore = options.minimumScore ?? MINIMUM_RETRIEVAL_SCORE;
  for (const candidate of candidates) {
    if (candidate.score < minimumScore) {
      exclusions.push({
        memoryId: candidate.memory.id,
        reason: "below-score-threshold",
      });
      continue;
    }
    if (selected.length >= options.maxItems) {
      exclusions.push({ memoryId: candidate.memory.id, reason: "item-budget" });
      continue;
    }
    if (estimatedTokens + candidate.estimatedTokens > options.maxTokens) {
      exclusions.push({
        memoryId: candidate.memory.id,
        reason: "token-budget",
      });
      continue;
    }
    selected.push(candidate);
    estimatedTokens += candidate.estimatedTokens;
  }
  return { candidates, selected, exclusions, estimatedTokens };
}

interface CandidateSignals {
  vector?: number;
  lexical?: number;
  structured?: number;
}

interface RetrievalSourceMatch {
  memoryId: string;
  score: number;
}

type RetrievalSource = "structured" | "lexical" | "vector";

export async function collectRetrievalSourceSignals(
  loaders: Record<RetrievalSource, () => Promise<RetrievalSourceMatch[]>>,
): Promise<{
  signals: Map<string, CandidateSignals>;
  exclusions: RetrievalExclusion[];
}> {
  const signals = new Map<string, CandidateSignals>();
  const exclusions: RetrievalExclusion[] = [];
  const sources = Object.entries(loaders) as [
    RetrievalSource,
    () => Promise<RetrievalSourceMatch[]>,
  ][];
  const settled = await Promise.allSettled(
    sources.map(([, loader]) => loader()),
  );
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]?.[0];
    const result = settled[index];
    if (!source || !result) continue;
    if (result.status === "rejected") {
      exclusions.push({ source, reason: "backend-unavailable" });
      continue;
    }
    for (const item of result.value) {
      signals.set(item.memoryId, {
        ...signals.get(item.memoryId),
        [source]: clampScore(item.score),
      });
    }
  }
  return { signals, exclusions };
}

function normalizedTextScore(value: number): number {
  return value <= 0 ? 0 : value / (value + 1);
}

export function retrievalQueryContainsDeniedContent(query: string): boolean {
  return findDeniedContent(query).length > 0;
}

function serializeCandidate(candidate: RankedRetrievalCandidate) {
  return {
    memoryId: candidate.memory.id,
    revisionId: candidate.memory.revisionId,
    statement: candidate.memory.statement,
    memoryType: candidate.memory.memoryType,
    sensitivity: candidate.memory.sensitivity,
    evidenceIds: candidate.memory.evidenceIds,
    score: candidate.score,
    estimatedTokens: candidate.estimatedTokens,
    components: candidate.components,
    reasons: candidate.reasons,
  };
}

function toRetrievalMemory(raw: Record<string, unknown>): RetrievalMemory {
  const temporal = (raw.temporal ?? {}) as {
    validFrom?: Date;
    validUntil?: Date;
  };
  return {
    id: String(raw._id),
    revisionId: String(raw.currentRevisionId),
    statement: String(raw.statement),
    memoryType: raw.memoryType as AgentMemoryType,
    status: raw.status as AgentMemoryStatus,
    explicitness: raw.explicitness as AgentExplicitness,
    confidence: Number(raw.confidence),
    importance: Number(raw.importance),
    trust: raw.trust as AgentTrust,
    sensitivity: raw.sensitivity as AgentSensitivity,
    validFrom: temporal.validFrom,
    validUntil: temporal.validUntil,
    evidenceIds: (raw.evidenceIds as string[]) ?? [],
    contradictionIds: ((raw.contradictionIds as unknown[]) ?? []).map(String),
    pinned: Boolean(raw.pinned),
    updatedAt: new Date(raw.updatedAt as Date),
  };
}

async function loadCandidateSignals(
  query: string,
  maxCandidates: number,
  allowVector: boolean,
): Promise<{
  signals: Map<string, CandidateSignals>;
  exclusions: RetrievalExclusion[];
}> {
  return collectRetrievalSourceSignals({
    structured: async () => {
      const structured = await AgentMemory.find({
        status: "active",
        sensitivity: { $in: RETRIEVABLE_SENSITIVITIES },
      })
        .sort({ pinned: -1, importance: -1, updatedAt: -1 })
        .limit(maxCandidates)
        .select("_id memoryType pinned")
        .lean();
      return structured.map((item) => ({
        memoryId: String(item._id),
        score: item.pinned ? 1 : item.memoryType === "core" ? 0.8 : 0.25,
      }));
    },
    lexical: async () => {
      const lexical = await AgentMemory.find(
        {
          $text: { $search: query },
          status: "active",
          sensitivity: { $in: RETRIEVABLE_SENSITIVITIES },
        },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(maxCandidates)
        .lean();
      return lexical.map((item) => ({
        memoryId: String(item._id),
        score: normalizedTextScore(Number((item as { score?: number }).score)),
      }));
    },
    vector: async () => {
      if (!allowVector) return [];
      const embedded = await embedText({
        purpose: "agent-memory-retrieval",
        source: "agent-memory-shadow-retrieval",
        model: AGENT_MEMORY_VECTOR_CONFIG.model,
        dimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
        value: query,
      });
      const vector = await AgentMemoryEmbedding.aggregate<{
        memoryId: mongoose.Types.ObjectId;
        score: number;
      }>([
        {
          $vectorSearch: {
            index: AGENT_MEMORY_VECTOR_CONFIG.indexName,
            path: AGENT_MEMORY_VECTOR_CONFIG.path,
            queryVector: embedded.vector,
            numCandidates: Math.max(100, maxCandidates * 5),
            limit: maxCandidates,
            filter: {
              model: AGENT_MEMORY_VECTOR_CONFIG.model,
              status: "active",
              sensitivity: { $in: RETRIEVABLE_SENSITIVITIES },
            },
          },
        },
        {
          $project: {
            _id: 0,
            memoryId: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ]);
      return vector.map((item) => ({
        memoryId: String(item.memoryId),
        score: item.score,
      }));
    },
  });
}

async function findInvalidEvidenceMemoryIds(
  memories: RetrievalMemory[],
  excludedSourceRefs: Parameters<typeof sourceRefIsExcluded>[1],
): Promise<Set<string>> {
  const eventIds = [...new Set(memories.flatMap((item) => item.evidenceIds))];
  const evidence = await AgentEvidenceEvent.find({ eventId: { $in: eventIds } })
    .select("eventId sourceRef memoryEligible redactedAt")
    .lean();
  const validEvidenceIds = new Set(
    evidence
      .filter(
        (item) =>
          item.memoryEligible &&
          !item.redactedAt &&
          !sourceRefIsExcluded(item.sourceRef, excludedSourceRefs),
      )
      .map((item) => item.eventId),
  );
  return new Set(
    memories
      .filter((memory) =>
        memory.evidenceIds.some((eventId) => !validEvidenceIds.has(eventId)),
      )
      .map((memory) => memory.id),
  );
}

export interface ShadowRetrievalResult {
  traceId: string;
  selectedRevisionIds: string[];
  abstained: boolean;
  estimatedTokens: number;
}

export async function retrieveMemoriesShadow(options: {
  conversationId?: string;
  requestId?: string;
  query: string;
  memoryMode: AgentMemoryMode;
}): Promise<ShadowRetrievalResult | null> {
  if (options.memoryMode !== "enabled") return null;
  const query = options.query.trim().slice(0, 8_192);
  if (!query) return null;
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.shadowRetrieval) return null;

  const maxCandidates = Math.max(20, settings.retrieval.maxRetrievedItems * 4);
  const deniedQuery = retrievalQueryContainsDeniedContent(query);
  const loaded = await loadCandidateSignals(query, maxCandidates, !deniedQuery);
  if (deniedQuery) {
    loaded.exclusions.push({ source: "vector", reason: "denied-query" });
  }
  const ids = [...loaded.signals.keys()];
  const rawMemories = await AgentMemory.find({ _id: { $in: ids } }).lean();
  const memories = rawMemories.map((item) =>
    toRetrievalMemory(item as unknown as Record<string, unknown>),
  );
  const invalidEvidenceIds = await findInvalidEvidenceMemoryIds(
    memories,
    settings.excludedSourceRefs,
  );
  const evidenceExclusions: RetrievalExclusion[] = [];
  const eligible = memories.filter((memory) => {
    if (!invalidEvidenceIds.has(memory.id)) return true;
    evidenceExclusions.push({
      memoryId: memory.id,
      source: "evidence",
      reason: "missing-redacted-or-excluded-evidence",
    });
    return false;
  });
  const ranked = rankAndBudgetRetrieval(
    eligible.map((memory) => ({
      memory,
      signals: loaded.signals.get(memory.id) ?? {},
    })),
    {
      maxItems: settings.retrieval.maxRetrievedItems,
      maxTokens: settings.retrieval.maxTokens,
    },
  );
  const traceId = randomUUID();
  await AgentRetrievalTrace.create({
    traceId,
    ...(options.conversationId &&
    mongoose.isValidObjectId(options.conversationId)
      ? { conversationId: new mongoose.Types.ObjectId(options.conversationId) }
      : {}),
    requestId: options.requestId,
    purpose: "dashboard-chat-shadow",
    query: deniedQuery ? "[query redacted: denied content]" : query,
    filters: {
      status: "active",
      sensitivities: RETRIEVABLE_SENSITIVITIES,
      embeddingModel: AGENT_MEMORY_VECTOR_CONFIG.model,
      vectorIndex: AGENT_MEMORY_VECTOR_CONFIG.indexName,
      minimumScore: MINIMUM_RETRIEVAL_SCORE,
      queryRedacted: deniedQuery,
    },
    candidates: ranked.candidates.map(serializeCandidate),
    exclusions: [
      ...loaded.exclusions,
      ...evidenceExclusions,
      ...ranked.exclusions,
    ],
    selectedRevisionIds: ranked.selected.map(
      (item) => new mongoose.Types.ObjectId(item.memory.revisionId),
    ),
    tokenBudget: settings.retrieval.maxTokens,
    estimatedTokens: ranked.estimatedTokens,
    injected: false,
    abstained: ranked.selected.length === 0,
  });
  return {
    traceId,
    selectedRevisionIds: ranked.selected.map((item) => item.memory.revisionId),
    abstained: ranked.selected.length === 0,
    estimatedTokens: ranked.estimatedTokens,
  };
}
