import { createHash, randomUUID } from "node:crypto";
import type {
  AgentActor,
  AgentMemoryMode,
  AgentSensitivity,
  AgentSourceRef,
  AgentSourceType,
  AgentTrust,
  CreateAgentEvidenceEvent,
  IChatMessageAttachment,
} from "@repo/schemas";
import { createAgentEvidenceEventSchema } from "@repo/schemas";
import type { ClientSession } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import type { IConversationMessage } from "@/models/Conversation";
import { type AttachmentPart, loadAttachmentParts } from "./attachments";
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

/**
 * Formation is debounced per source entity: evidence arriving for the same
 * entity within one window coalesces into a single job, so one LLM call sees
 * the related events together instead of one call per message/save. The job
 * only becomes leasable after the window closes (plus grace, so a job never
 * gets leased while its window can still receive events).
 */
const FORMATION_DEBOUNCE_MS = 10 * 60_000;
const FORMATION_LEASE_GRACE_MS = 30_000;

export function formationJobKey(
  sourceRef: AgentSourceRef,
  occurredAtMs: number,
): { key: string; availableAt: Date } {
  const bucket = Math.floor(occurredAtMs / FORMATION_DEBOUNCE_MS);
  return {
    key: `formation:${sourceRef.entityType}:${sourceRef.entityId}:${bucket}`,
    availableAt: new Date(
      (bucket + 1) * FORMATION_DEBOUNCE_MS + FORMATION_LEASE_GRACE_MS,
    ),
  };
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
  enqueueFormation?: boolean;
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
    if (evidence.memoryEligible && options.enqueueFormation !== false) {
      const job = formationJobKey(evidence.sourceRef, Date.now());
      await AgentMemoryJob.findOneAndUpdate(
        { idempotencyKey: job.key, status: "pending" },
        {
          $addToSet: { evidenceIds: eventId },
          $setOnInsert: {
            idempotencyKey: job.key,
            operation: "formation",
            memoryIds: [],
            status: "pending",
            attempts: 0,
            availableAt: job.availableAt,
          },
        },
        { upsert: true, session },
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
      // Only report duplicate when the evidence itself already exists — a key
      // collision elsewhere in the transaction (e.g. the formation job) must
      // surface instead of silently dropping the evidence.
      if (duplicate) return { status: "duplicate", eventId: duplicate.eventId };
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

/**
 * Attachments are persisted as content blocks rather than a separate field, so
 * they are recovered from the stored message shape that `messageContent`
 * writes: an `image`/`document` block carrying a url source.
 */
function messageAttachments(
  message: IConversationMessage,
): IChatMessageAttachment[] {
  if (!Array.isArray(message.content)) return [];
  const attachments: IChatMessageAttachment[] = [];
  for (const block of message.content) {
    if (block.type !== "image" && block.type !== "document") continue;
    const url = block.source?.url;
    if (typeof url !== "string" || !url) continue;
    attachments.push({
      type: block.type === "image" ? "image" : "pdf",
      url,
      name: block.name ?? url.split("/").pop() ?? "attachment",
    });
  }
  return attachments;
}

/**
 * Describes an attachment part well enough to be useful on its own once it is
 * detached from the message that carried it. Image parts have no text of their
 * own, so the filename plus surrounding message is all the snapshot can offer;
 * the retrievable signal for those comes from the image embedding itself.
 */
function attachmentSnapshot(
  attachment: IChatMessageAttachment,
  part: AttachmentPart,
  messageText: string,
): string {
  const where = part.page ? ` (page ${part.page})` : "";
  const header = `${attachment.type === "image" ? "Image" : "PDF"} attachment "${attachment.name}"${where}`;
  if (part.text) return `${header}\n\n${part.text}`;
  const context = messageText.trim().slice(0, 500);
  return context ? `${header}\n\nSent with: ${context}` : header;
}

/**
 * Emits one evidence row per attachment part — a whole image, or a single PDF
 * chunk. Failures are per-attachment: an unreachable URL or an unreadable PDF
 * must not lose the message's text evidence.
 */
async function observeMessageAttachments(options: {
  conversationId: string;
  memoryMode: AgentMemoryMode;
  message: IConversationMessage;
  messageText: string;
  session?: ClientSession;
  stats: {
    created: number;
    duplicate: number;
    skipped: number;
    rejected: number;
  };
}): Promise<void> {
  const attachments = messageAttachments(options.message);
  for (const [position, attachment] of attachments.entries()) {
    let loaded: Awaited<ReturnType<typeof loadAttachmentParts>>;
    try {
      loaded = await loadAttachmentParts(attachment);
    } catch (error) {
      options.stats.skipped += 1;
      console.warn("[agent-memory] Attachment could not be read", {
        name: attachment.name,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (loaded.parts.length === 0) {
      // A scanned PDF with no text layer: nothing to say about it.
      options.stats.skipped += 1;
      continue;
    }

    for (const part of loaded.parts) {
      try {
        const result = await observeEvidence({
          memoryMode: options.memoryMode,
          session: options.session,
          evidence: buildEvidenceInput({
            idempotencyKey: `conversation:${options.conversationId}:message:${options.message.eventId}:attachment:${position}:part:${part.index}`,
            sourceType: "attachment",
            sourceRef: {
              entityType: "conversation",
              entityId: options.conversationId,
              revision: options.message.eventId,
            },
            sourceRevision: options.message.eventId,
            content: {
              url: attachment.url,
              part: part.index,
              text: part.text ?? null,
            },
            snapshot: attachmentSnapshot(attachment, part, options.messageText),
            occurredAt: options.message.createdAt,
            actor: options.message.role === "user" ? "user" : "agent",
            // Attaching a file vouches for sending it, never for what is
            // inside it, so contents stay below conversational trust.
            trust: "low",
            sensitivity: "personal",
            provenance: {
              attachmentName: attachment.name,
              attachmentType: attachment.type,
              attachmentUrl: attachment.url,
              part: part.index,
              page: part.page ?? null,
              // Retrieval re-embeds from this, so it must survive the round trip.
              hasImage: Boolean(part.image),
            },
          }),
        });
        options.stats[result.status] += 1;
      } catch (error) {
        if (!(error instanceof AgentMemoryPolicyError)) throw error;
        options.stats.rejected += 1;
        console.warn("[agent-memory] Attachment evidence rejected", {
          code: error.code,
        });
      }
    }
  }
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

    await observeMessageAttachments({
      conversationId: options.conversationId,
      memoryMode: options.memoryMode,
      message,
      messageText: content,
      session: options.session,
      stats,
    });
  }
  return stats;
}
