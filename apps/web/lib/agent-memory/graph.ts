import type { AgentMemoryGraphLink, AgentMemoryGraphNode } from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemorySimilarity } from "@/models/AgentMemorySimilarity";
import { Person } from "@/models/Person";
import { VoiceNote } from "@/models/VoiceNote";
import { AGENT_MEMORY_VECTOR_CONFIG } from "./vector-config";

const MIN_ENTITY_MEMBERS = 2;
const LABEL_LENGTH = 140;

export interface GraphMemoryInput {
  id: string;
  statement: string;
  memoryType: string;
  status: string;
  confidence: number;
  importance: number;
  entityRefs: {
    entityType: string;
    entityId: string;
    label?: string;
    resourceId?: string;
  }[];
  contradictionIds: string[];
  supersedesMemoryId?: string;
  /** Attachment image behind this memory, when one of its evidence rows has one. */
  imageUrl?: string;
  /** Voice note behind this memory, when it was formed from a transcript. */
  voiceNote?: AgentMemoryGraphNode["voiceNote"];
  /** What the memory is about, not when it was stored. See the graph node schema. */
  occurredAt?: string;
  occurredUntil?: string;
}

export interface GraphSimilarityInput {
  /** Memories that currently have a stored embedding. */
  embeddedMemoryIds: string[];
  /** Precomputed similarity links (maintained by the embedding/consolidation jobs). */
  similarLinks: AgentMemoryGraphLink[];
}

export interface GraphOwnerInput {
  id?: string;
  name: string;
  email: string;
  displayName?: string;
  resourceId?: string;
}

const OWNER_NODE_ID = "entity:person:owner";

function normalizeIdentity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function exactCaseInsensitivePattern(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

/**
 * Owner person-refs are scattered across ids/labels ("deniz-gunes", "deniz",
 * the email, "user" with a full-name label, accented variants). A ref is the
 * owner when its id or label matches the email, or its tokens are all owner
 * name tokens and include the first name.
 */
export function ownerRefMatcher(
  owner: GraphOwnerInput,
): (ref: { entityType: string; entityId: string; label?: string }) => boolean {
  const ownerId = owner.id ? normalizeIdentity(owner.id) : "";
  const email = normalizeIdentity(owner.email);
  const nameTokens = normalizeIdentity(owner.name).split(" ").filter(Boolean);
  const firstName = nameTokens[0] ?? "";
  const matchesValue = (value: string | undefined): boolean => {
    if (!value) return false;
    const normalized = normalizeIdentity(value);
    if (!normalized) return false;
    if (normalized === email) return true;
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length === 0 || !tokens.includes(firstName)) return false;
    // Subset either way: "deniz" ⊂ name, or full legal name ⊃ auth name.
    return (
      tokens.every((token) => nameTokens.includes(token)) ||
      nameTokens.every((token) => tokens.includes(token))
    );
  };
  return (ref) => {
    if (ref.entityType !== "person") return false;
    const entityId = normalizeIdentity(ref.entityId);
    return (
      entityId === "owner" ||
      entityId === "admin" ||
      entityId === "user" ||
      (ownerId.length > 0 && entityId === ownerId) ||
      matchesValue(ref.entityId) ||
      matchesValue(ref.label)
    );
  };
}

export function buildAgentMemoryGraph(
  memories: GraphMemoryInput[],
  similarity: GraphSimilarityInput,
  owner?: GraphOwnerInput,
): {
  nodes: AgentMemoryGraphNode[];
  links: AgentMemoryGraphLink[];
  embeddedCount: number;
} {
  const memoryIds = new Set(memories.map((memory) => memory.id));
  const embeddedIds = new Set(
    similarity.embeddedMemoryIds.filter((memoryId) => memoryIds.has(memoryId)),
  );

  const nodes: AgentMemoryGraphNode[] = memories.map((memory) => ({
    id: memory.id,
    kind: "memory",
    label:
      memory.statement.length > LABEL_LENGTH
        ? `${memory.statement.slice(0, LABEL_LENGTH)}…`
        : memory.statement,
    memoryType: memory.memoryType as AgentMemoryGraphNode["memoryType"],
    status: memory.status as AgentMemoryGraphNode["status"],
    confidence: memory.confidence,
    importance: memory.importance,
    hasEmbedding: embeddedIds.has(memory.id),
    ...(memory.imageUrl ? { imageUrl: memory.imageUrl } : {}),
    ...(memory.voiceNote ? { voiceNote: memory.voiceNote } : {}),
    ...(memory.occurredAt ? { occurredAt: memory.occurredAt } : {}),
    ...(memory.occurredUntil ? { occurredUntil: memory.occurredUntil } : {}),
  }));

  const links: AgentMemoryGraphLink[] = [];
  const linkKeys = new Set<string>();
  const pushLink = (link: AgentMemoryGraphLink) => {
    const [source, target] = [link.source, link.target].sort();
    if (!source || !target || source === target) return;
    if (!memoryIds.has(source) && !source.startsWith("entity:")) return;
    if (!memoryIds.has(target) && !target.startsWith("entity:")) return;
    const key = `${link.type}:${source}:${target}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ ...link, source, target });
  };
  for (const link of similarity.similarLinks) {
    if (!memoryIds.has(link.source) || !memoryIds.has(link.target)) continue;
    pushLink({ ...link, strength: Math.min(1, link.strength) });
  }

  const isOwnerRef = owner ? ownerRefMatcher(owner) : () => false;
  const entityMembers = new Map<
    string,
    {
      entityType: string;
      label: string;
      resourceId?: string;
      memberIds: string[];
    }
  >();
  for (const memory of memories) {
    const seen = new Set<string>();
    for (const ref of memory.entityRefs) {
      const id = isOwnerRef(ref)
        ? OWNER_NODE_ID
        : `entity:${ref.entityType}:${ref.entityId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = entityMembers.get(id) ?? {
        entityType: ref.entityType,
        label: "",
        memberIds: [],
      };
      if (!entry.label && ref.label?.trim()) entry.label = ref.label.trim();
      if (!entry.resourceId && ref.resourceId) {
        entry.resourceId = ref.resourceId;
      }
      entry.memberIds.push(memory.id);
      entityMembers.set(id, entry);
    }
  }
  if (owner && !entityMembers.has(OWNER_NODE_ID)) {
    entityMembers.set(OWNER_NODE_ID, {
      entityType: "person",
      label: owner.displayName ?? owner.name,
      resourceId: owner.resourceId,
      memberIds: [],
    });
  }
  for (const [id, entry] of [...entityMembers.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const isOwnerNode = id === OWNER_NODE_ID;
    if (!isOwnerNode && entry.memberIds.length < MIN_ENTITY_MEMBERS) continue;
    const label = isOwnerNode
      ? owner?.displayName || owner?.name || entry.label || "Owner"
      : entry.label || id.split(":").slice(2).join(":");
    const resourceId = isOwnerNode
      ? (owner?.resourceId ?? entry.resourceId)
      : entry.resourceId;
    nodes.push({
      id,
      kind: "entity",
      label:
        label.length > LABEL_LENGTH
          ? `${label.slice(0, LABEL_LENGTH)}…`
          : label,
      entityType: entry.entityType,
      ...(resourceId ? { resourceId } : {}),
      count: entry.memberIds.length,
      ...(isOwnerNode ? { isOwner: true } : {}),
    });
    for (const memberId of entry.memberIds) {
      pushLink({ source: id, target: memberId, type: "entity", strength: 0.5 });
    }
  }

  for (const memory of memories) {
    for (const contradictionId of memory.contradictionIds) {
      if (!memoryIds.has(contradictionId)) continue;
      pushLink({
        source: memory.id,
        target: contradictionId,
        type: "contradiction",
        strength: 0.8,
      });
    }
    if (memory.supersedesMemoryId && memoryIds.has(memory.supersedesMemoryId)) {
      pushLink({
        source: memory.id,
        target: memory.supersedesMemoryId,
        type: "supersession",
        strength: 0.6,
      });
    }
  }

  return { nodes, links, embeddedCount: embeddedIds.size };
}

/**
 * Maps memories to the attachment image they were formed from, so the graph can
 * draw the picture itself instead of a generic node. One query covers the whole
 * graph: evidence does not point back at memories, so the lookup goes through
 * the evidence ids each memory already carries.
 */
async function resolveMemoryImages(
  memories: { _id: { toString(): string }; evidenceIds?: unknown[] }[],
): Promise<Map<string, string>> {
  const eventIds = memories.flatMap((memory) =>
    (memory.evidenceIds ?? []).map(String),
  );
  if (eventIds.length === 0) return new Map();

  const events = await AgentEvidenceEvent.find({
    eventId: { $in: eventIds },
    sourceType: "attachment",
    redactedAt: { $exists: false },
    memoryEligible: true,
    "provenance.hasImage": true,
  })
    .select("eventId provenance")
    .lean<{ eventId: string; provenance?: Record<string, unknown> }[]>();

  const urlByEventId = new Map<string, string>();
  for (const event of events) {
    const url = event.provenance?.attachmentUrl;
    if (typeof url === "string" && url) urlByEventId.set(event.eventId, url);
  }
  if (urlByEventId.size === 0) return new Map();

  const imageByMemoryId = new Map<string, string>();
  for (const memory of memories) {
    for (const eventId of memory.evidenceIds ?? []) {
      const url = urlByEventId.get(String(eventId));
      if (url) {
        imageByMemoryId.set(memory._id.toString(), url);
        break;
      }
    }
  }
  return imageByMemoryId;
}

/**
 * Maps memories to the voice note they were transcribed from, so the graph can
 * draw a recording rather than a wall of text and play it without a second
 * round trip. Mirrors resolveMemoryImages: evidence does not point back at
 * memories, so the lookup goes through the evidence ids each memory carries.
 */
async function resolveMemoryVoiceNotes(
  memories: { _id: { toString(): string }; evidenceIds?: unknown[] }[],
): Promise<Map<string, NonNullable<GraphMemoryInput["voiceNote"]>>> {
  const eventIds = memories.flatMap((memory) =>
    (memory.evidenceIds ?? []).map(String),
  );
  if (eventIds.length === 0) return new Map();

  const events = await AgentEvidenceEvent.find({
    eventId: { $in: eventIds },
    sourceType: "voice-note",
    redactedAt: { $exists: false },
    memoryEligible: true,
  })
    .select("eventId sourceRef")
    .lean<{ eventId: string; sourceRef?: { entityId?: string } }[]>();
  if (events.length === 0) return new Map();

  const voiceNoteIdByEventId = new Map<string, string>();
  for (const event of events) {
    const id = event.sourceRef?.entityId;
    if (id) voiceNoteIdByEventId.set(event.eventId, id);
  }
  const uniqueIds = [...new Set(voiceNoteIdByEventId.values())].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (uniqueIds.length === 0) return new Map();

  const voiceNotes = await VoiceNote.find({ _id: { $in: uniqueIds } })
    .select("title durationMs waveform")
    .lean<
      {
        _id: mongoose.Types.ObjectId;
        title: string;
        durationMs?: number;
        waveform?: number[];
      }[]
    >();
  const byId = new Map(
    voiceNotes.map((voiceNote) => [
      voiceNote._id.toString(),
      {
        id: voiceNote._id.toString(),
        title: voiceNote.title,
        ...(voiceNote.durationMs !== undefined
          ? { durationMs: voiceNote.durationMs }
          : {}),
        waveform: (voiceNote.waveform ?? []).slice(0, 240),
      },
    ]),
  );

  const byMemoryId = new Map<
    string,
    NonNullable<GraphMemoryInput["voiceNote"]>
  >();
  for (const memory of memories) {
    for (const eventId of memory.evidenceIds ?? []) {
      const voiceNoteId = voiceNoteIdByEventId.get(String(eventId));
      const voiceNote = voiceNoteId ? byId.get(voiceNoteId) : undefined;
      if (voiceNote) {
        byMemoryId.set(memory._id.toString(), voiceNote);
        break;
      }
    }
  }
  return byMemoryId;
}

/**
 * `temporal.*` is stored as an ISO string and `createdAt` as a Date, while the
 * graph schema demands an offset-bearing ISO string. Unparseable values drop
 * rather than failing the whole graph read.
 */
function isoOrUndefined(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Earliest evidence timestamp per memory — the fallback for memories that do
 * not state their own `temporal.validFrom`. Evidence is what the memory was
 * formed from, so its oldest event is the best available "when".
 */
async function resolveMemoryEvidenceDates(
  memories: { _id: { toString(): string }; evidenceIds?: unknown[] }[],
): Promise<Map<string, string>> {
  const eventIds = memories.flatMap((memory) =>
    (memory.evidenceIds ?? []).map(String),
  );
  if (eventIds.length === 0) return new Map();

  const events = await AgentEvidenceEvent.find({
    eventId: { $in: eventIds },
  })
    .select("eventId occurredAt")
    .lean<{ eventId: string; occurredAt: Date }[]>();

  const dateByEventId = new Map<string, Date>();
  for (const event of events) {
    if (event.occurredAt) dateByEventId.set(event.eventId, event.occurredAt);
  }

  const dateByMemoryId = new Map<string, string>();
  for (const memory of memories) {
    let earliest: Date | undefined;
    for (const eventId of memory.evidenceIds ?? []) {
      const occurredAt = dateByEventId.get(String(eventId));
      if (occurredAt && (!earliest || occurredAt < earliest)) {
        earliest = occurredAt;
      }
    }
    if (earliest) {
      dateByMemoryId.set(memory._id.toString(), earliest.toISOString());
    }
  }
  return dateByMemoryId;
}

export async function loadAgentMemoryGraph() {
  await connectDB();
  // Single-admin app: the better-auth user collection holds exactly the owner.
  const ownerDoc = await AgentMemory.db
    .collection("user")
    .findOne<{ _id: unknown; name?: string; email?: string }>(
      {},
      { projection: { _id: 1, name: 1, email: 1 } },
    );
  const ownerPerson =
    ownerDoc?.email &&
    (await Person.findOne({
      email: exactCaseInsensitivePattern(ownerDoc.email.trim()),
    })
      .select("name")
      .lean<{ _id: unknown; name: string }>());
  const owner: GraphOwnerInput | undefined =
    ownerDoc?.name && ownerDoc?.email
      ? {
          id: String(ownerDoc._id),
          name: ownerDoc.name,
          email: ownerDoc.email,
          ...(ownerPerson
            ? {
                displayName: ownerPerson.name,
                resourceId: String(ownerPerson._id),
              }
            : {}),
        }
      : undefined;
  // Similarity is precomputed by the embedding/consolidation jobs, so the
  // graph is a plain read and stays uncapped. Active only: superseded and
  // archived memories are list-view material, not part of the live graph.
  const [memories, embeddedMemoryIds, similarityDocs] = await Promise.all([
    AgentMemory.find({ status: "active" })
      .select(
        "statement memoryType status confidence importance entityRefs contradictionIds supersedesMemoryId evidenceIds temporal createdAt",
      )
      .sort({ createdAt: 1 })
      .lean(),
    // Scoped to the deployed vector contract: a vector from a retired model is
    // not reachable by recall, so it must not light the node up as embedded.
    AgentMemoryEmbedding.distinct("memoryId", {
      model: AGENT_MEMORY_VECTOR_CONFIG.model,
      status: "active",
    }),
    AgentMemorySimilarity.find({ model: AGENT_MEMORY_VECTOR_CONFIG.model })
      .select("sourceMemoryId targetMemoryId strength")
      .lean(),
  ]);

  const [imageByMemoryId, voiceNoteByMemoryId, evidenceDateByMemoryId] =
    await Promise.all([
      resolveMemoryImages(memories),
      resolveMemoryVoiceNotes(memories),
      resolveMemoryEvidenceDates(memories),
    ]);

  const graph = buildAgentMemoryGraph(
    memories.map((memory) => ({
      id: memory._id.toString(),
      statement: memory.statement,
      memoryType: memory.memoryType,
      status: memory.status,
      confidence: memory.confidence,
      importance: memory.importance,
      entityRefs: (memory.entityRefs ?? []) as GraphMemoryInput["entityRefs"],
      contradictionIds: (memory.contradictionIds ?? []).map(String),
      supersedesMemoryId: memory.supersedesMemoryId?.toString(),
      imageUrl: imageByMemoryId.get(memory._id.toString()),
      voiceNote: voiceNoteByMemoryId.get(memory._id.toString()),
      occurredAt:
        isoOrUndefined(memory.temporal?.validFrom) ??
        evidenceDateByMemoryId.get(memory._id.toString()) ??
        isoOrUndefined(memory.createdAt),
      occurredUntil: isoOrUndefined(memory.temporal?.validUntil),
    })),
    {
      embeddedMemoryIds: embeddedMemoryIds.map(String),
      similarLinks: similarityDocs.map((doc) => ({
        source: doc.sourceMemoryId.toString(),
        target: doc.targetMemoryId.toString(),
        type: "similar" as const,
        strength: doc.strength,
      })),
    },
    owner,
  );

  return { ...graph, generatedAt: new Date().toISOString() };
}
