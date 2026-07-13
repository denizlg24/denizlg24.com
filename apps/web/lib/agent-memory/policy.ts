import type {
  AgentActor,
  AgentExplicitness,
  AgentMemoryType,
  AgentSensitivity,
  AgentSourceRef,
  AgentSourceType,
  AgentTrust,
} from "@repo/schemas";
import {
  containsPermissionLikeInstruction,
  findDeniedContent,
} from "./security";

export class AgentMemoryPolicyError extends Error {
  constructor(
    message: string,
    readonly code:
      | "denied-content"
      | "permission-like"
      | "invalid-provenance"
      | "trust-escalation"
      | "gate-disabled"
      | "unsafe-promotion"
      | "not-found"
      | "conflict",
  ) {
    super(message);
    this.name = "AgentMemoryPolicyError";
  }
}

const TRUST_SCORE: Record<AgentTrust, number> = {
  untrusted: 0,
  derived: 1,
  low: 2,
  medium: 3,
  high: 4,
  highest: 5,
};

const SOURCE_POLICY: Record<
  AgentSourceType,
  { actors: AgentActor[]; maximumTrust: AgentTrust }
> = {
  conversation: { actors: ["user", "agent"], maximumTrust: "high" },
  "tool-result": {
    actors: ["user", "agent", "system"],
    maximumTrust: "medium",
  },
  feedback: { actors: ["user", "system"], maximumTrust: "highest" },
  note: { actors: ["user", "external"], maximumTrust: "high" },
  calendar: { actors: ["user", "external", "system"], maximumTrust: "high" },
  person: { actors: ["user", "system"], maximumTrust: "high" },
  project: { actors: ["user", "system"], maximumTrust: "high" },
  course: { actors: ["user", "system"], maximumTrust: "high" },
  "email-triage": {
    actors: ["external", "agent", "system"],
    maximumTrust: "untrusted",
  },
  journal: { actors: ["user", "system"], maximumTrust: "high" },
  file: { actors: ["user", "external"], maximumTrust: "untrusted" },
  manual: { actors: ["user", "system"], maximumTrust: "highest" },
};

export interface EvidencePolicyInput {
  sourceType: AgentSourceType;
  sourceRef: AgentSourceRef;
  actor: AgentActor;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  snapshot?: string;
  provenance: Record<string, unknown>;
}

export function assertEvidencePolicy(input: EvidencePolicyInput): void {
  if (!input.sourceRef.entityType || !input.sourceRef.entityId) {
    throw new AgentMemoryPolicyError(
      "Evidence requires a canonical source reference",
      "invalid-provenance",
    );
  }

  const sourcePolicy = SOURCE_POLICY[input.sourceType];
  if (!sourcePolicy.actors.includes(input.actor)) {
    throw new AgentMemoryPolicyError(
      `Actor ${input.actor} is invalid for ${input.sourceType} evidence`,
      "invalid-provenance",
    );
  }

  if (TRUST_SCORE[input.trust] > TRUST_SCORE[sourcePolicy.maximumTrust]) {
    throw new AgentMemoryPolicyError(
      `${input.sourceType} evidence cannot claim ${input.trust} trust`,
      "trust-escalation",
    );
  }

  if (input.actor === "external" && input.trust !== "untrusted") {
    throw new AgentMemoryPolicyError(
      "External evidence must remain untrusted until corroborated",
      "trust-escalation",
    );
  }

  if (input.sensitivity === "denied") {
    throw new AgentMemoryPolicyError(
      "Denied sensitivity cannot be persisted",
      "denied-content",
    );
  }

  if (
    findDeniedContent({
      snapshot: input.snapshot,
      provenance: input.provenance,
    }).length > 0
  ) {
    throw new AgentMemoryPolicyError(
      "Evidence contains credential or authentication material",
      "denied-content",
    );
  }
}

export interface CandidatePolicyInput {
  statement: string;
  memoryType: AgentMemoryType;
  explicitness: AgentExplicitness;
  confidence: number;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  evidenceIds: string[];
  reviewFlags: string[];
}

export function assertCandidateSafety(input: CandidatePolicyInput): void {
  if (input.evidenceIds.length === 0) {
    throw new AgentMemoryPolicyError(
      "Active memory requires supporting evidence",
      "invalid-provenance",
    );
  }
  if (
    input.sensitivity === "denied" ||
    findDeniedContent(input.statement).length > 0
  ) {
    throw new AgentMemoryPolicyError(
      "Candidate contains denied secret material",
      "denied-content",
    );
  }
  if (containsPermissionLikeInstruction(input.statement)) {
    throw new AgentMemoryPolicyError(
      "Memory cannot represent permissions, approval, or system policy",
      "permission-like",
    );
  }
}

export function canAutomaticallyPromoteCandidate(
  input: CandidatePolicyInput,
  options: { independentTrustedEvidenceCount: number },
): { allowed: boolean; reason: string } {
  try {
    assertCandidateSafety(input);
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : "Candidate rejected",
    };
  }

  if (input.reviewFlags.length > 0) {
    return { allowed: false, reason: "Candidate requires exception review" };
  }
  if (input.explicitness === "hypothesis") {
    return { allowed: false, reason: "Hypotheses require review" };
  }
  if (input.trust === "untrusted" && input.memoryType === "core") {
    return {
      allowed: false,
      reason: "Untrusted evidence cannot become core memory",
    };
  }
  if (input.explicitness === "explicit") {
    const allowed =
      TRUST_SCORE[input.trust] >= TRUST_SCORE.medium &&
      input.confidence >= 0.85;
    return {
      allowed,
      reason: allowed
        ? "High-confidence explicit trusted statement"
        : "Explicit statement is below trust or confidence threshold",
    };
  }

  const minimumEvidence = input.memoryType === "core" ? 3 : 2;
  const minimumConfidence = input.memoryType === "core" ? 0.95 : 0.9;
  const allowed =
    options.independentTrustedEvidenceCount >= minimumEvidence &&
    input.confidence >= minimumConfidence &&
    TRUST_SCORE[input.trust] >= TRUST_SCORE.medium;

  return {
    allowed,
    reason: allowed
      ? "Inference passed independent corroboration thresholds"
      : "Inference requires more independent trusted corroboration",
  };
}

export function sourceRefIsExcluded(
  sourceRef: AgentSourceRef,
  exclusions: AgentSourceRef[],
): boolean {
  return exclusions.some(
    (excluded) =>
      excluded.entityType === sourceRef.entityType &&
      excluded.entityId === sourceRef.entityId &&
      (!excluded.revision || excluded.revision === sourceRef.revision),
  );
}
