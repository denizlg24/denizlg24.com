import { createHash, randomUUID } from "node:crypto";
import type {
  AgentActor,
  AgentMemoryMode,
  AgentSensitivity,
  AgentSourceRef,
  AgentSourceType,
  AgentTrust,
  CreateAgentEvidenceEvent,
} from "@repo/schemas";
import { createAgentEvidenceEventSchema } from "@repo/schemas";
import type { ClientSession } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import type { IConversationMessage } from "@/models/Conversation";
import {
  AgentMemoryPolicyError,
  assertEvidencePolicy,
  sourceRefIsExcluded,
} from "./policy";
import { normalizeEvidenceText } from "./security";
import { getAgentMemorySettings } from "./settings";

export interface EvidenceObservationResult {
  status: "created" | "duplicate" | "skipped";
  eventId?: string;
  reason?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function stableContentHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function buildEvidenceInput(input: {
  idempotencyKey: string;
  sourceType: AgentSourceType;
  sourceRef: AgentSourceRef;
  sourceRevision?: string;
  content: unknown;
  snapshot?: string;
  occurredAt: Date;
  actor: AgentActor;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  memoryEligible?: boolean;
  provenance?: Record<string, unknown>;
}): CreateAgentEvidenceEvent {
  return createAgentEvidenceEventSchema.parse({
    idempotencyKey: input.idempotencyKey,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    sourceRevision: input.sourceRevision,
    contentHash: stableContentHash(input.content),
    snapshot:
      input.snapshot === undefined
        ? undefined
        : normalizeEvidenceText(input.snapshot),
    occurredAt: input.occurredAt.toISOString(),
    actor: input.actor,
    trust: input.trust,
    sensitivity: input.sensitivity,
    memoryEligible: input.memoryEligible ?? true,
    provenance: input.provenance ?? {},
  });
}

async function writeEvidenceAudit(
  eventId: string,
  sourceType: AgentSourceType,
  session: ClientSession,
) {
  await AgentAuditEvent.create(
    [
      {
        auditId: randomUUID(),
        action: "evidence.append",
        actor: "system",
        targetType: "evidence",
        targetId: eventId,
        reason: `Observed ${sourceType} evidence`,
        metadata: { sourceType },
        contentRedacted: false,
        occurredAt: new Date(),
      },
    ],
    { session },
  );
}

export async function observeEvidence(options: {
  memoryMode: AgentMemoryMode;
  evidence: CreateAgentEvidenceEvent;
  session?: ClientSession;
}): Promise<EvidenceObservationResult> {
  if (options.memoryMode === "incognito") {
    return { status: "skipped", reason: "incognito" };
  }

  const evidence = createAgentEvidenceEventSchema.parse(options.evidence);
  assertEvidencePolicy(evidence);
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.evidenceLedger) {
    return { status: "skipped", reason: "gate-a-disabled" };
  }
  if (!settings.enabledSources.includes(evidence.sourceType)) {
    return { status: "skipped", reason: "source-disabled" };
  }
  if (sourceRefIsExcluded(evidence.sourceRef, settings.excludedSourceRefs)) {
    return { status: "skipped", reason: "source-excluded" };
  }

  await connectDB();
  const existing = await AgentEvidenceEvent.findOne({
    idempotencyKey: evidence.idempotencyKey,
  })
    .select("eventId")
    .session(options.session ?? null)
    .lean<{ eventId: string }>();
  if (existing) return { status: "duplicate", eventId: existing.eventId };

  const eventId = randomUUID();
  const persist = async (session: ClientSession) => {
    await AgentEvidenceEvent.create(
      [
        {
          ...evidence,
          eventId,
          occurredAt: new Date(evidence.occurredAt),
          observedAt: new Date(),
        },
      ],
      { session },
    );
    if (evidence.memoryEligible) {
      await AgentMemoryJob.create(
        [
          {
            idempotencyKey: `formation:${eventId}`,
            operation: "formation",
            evidenceIds: [eventId],
            memoryIds: [],
            status: "pending",
            attempts: 0,
            availableAt: new Date(),
          },
        ],
        { session },
      );
    }
    await writeEvidenceAudit(eventId, evidence.sourceType, session);
  };

  if (options.session) {
    await persist(options.session);
    return { status: "created", eventId };
  }

  const session = await AgentEvidenceEvent.startSession();
  try {
    await session.withTransaction(() => persist(session));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      const duplicate = await AgentEvidenceEvent.findOne({
        idempotencyKey: evidence.idempotencyKey,
      })
        .select("eventId")
        .lean<{ eventId: string }>();
      return { status: "duplicate", eventId: duplicate?.eventId };
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return { status: "created", eventId };
}

function contentSnapshot(message: IConversationMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

function containsToolResult(message: IConversationMessage): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((block) => block.type === "tool_result")
  );
}

export async function observeConversationMessages(options: {
  conversationId: string;
  memoryMode: AgentMemoryMode;
  messages: IConversationMessage[];
  session?: ClientSession;
}): Promise<{
  created: number;
  duplicate: number;
  skipped: number;
  rejected: number;
}> {
  if (options.memoryMode === "incognito") {
    return {
      created: 0,
      duplicate: 0,
      skipped: options.messages.length,
      rejected: 0,
    };
  }

  const stats = { created: 0, duplicate: 0, skipped: 0, rejected: 0 };
  for (const message of options.messages) {
    const toolResult = containsToolResult(message);
    const content = contentSnapshot(message);
    try {
      const result = await observeEvidence({
        memoryMode: options.memoryMode,
        session: options.session,
        evidence: buildEvidenceInput({
          idempotencyKey: `conversation:${options.conversationId}:message:${message.eventId}`,
          sourceType: toolResult ? "tool-result" : "conversation",
          sourceRef: {
            entityType: "conversation",
            entityId: options.conversationId,
            revision: message.eventId,
          },
          sourceRevision: message.eventId,
          content: message.content,
          snapshot: content,
          occurredAt: message.createdAt,
          actor: message.role === "user" && !toolResult ? "user" : "agent",
          trust: message.role === "user" && !toolResult ? "high" : "medium",
          sensitivity: "personal",
          provenance: { role: message.role, toolResult },
        }),
      });
      stats[result.status] += 1;
    } catch (error) {
      if (!(error instanceof AgentMemoryPolicyError)) throw error;
      stats.rejected += 1;
      console.warn("[agent-memory] Evidence observation rejected", {
        sourceType: toolResult ? "tool-result" : "conversation",
        code: error.code,
      });
    }
  }
  return stats;
}
