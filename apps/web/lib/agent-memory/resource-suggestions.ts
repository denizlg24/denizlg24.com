import { randomUUID } from "node:crypto";
import type { AgentEntityRef, AgentPersonDraft } from "@repo/schemas";
import { agentPersonDraftSchema } from "@repo/schemas";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { createPerson } from "@/lib/people";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import {
  AgentResourceSuggestion,
  type IAgentResourceSuggestion,
} from "@/models/AgentResourceSuggestion";
import { type ILeanPerson, Person } from "@/models/Person";
import { OWNER_REFERENCE } from "./consolidation";
import {
  attachPersonResourceToEntity,
  replaceMemoryEntityRefs,
} from "./governance";
import { type GraphOwnerInput, ownerRefMatcher } from "./graph";
import { AgentMemoryPolicyError } from "./policy";
import { findDeniedContent } from "./security";
import { getAgentMemorySettings } from "./settings";

const MAX_MEMORIES_PER_ENTITY = 30;
const DETERMINISTIC_MODEL = "deterministic";

export interface SuggestionMemoryInput {
  id: string;
  statement: string;
  createdAt: Date;
  entityRefs: {
    entityType: string;
    entityId: string;
    label?: string;
    resourceId?: string;
  }[];
}

export interface PersonEntityCluster {
  entityKey: string;
  label: string;
  memoryIds: string[];
  resourceIds: string[];
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Group memories by the person entity they reference, excluding the owner —
 * the owner is not a directory entry. The entityKey mirrors the graph's
 * entity node ids ("person:<entityId>") so the UI can cross-link them.
 */
export function buildPersonEntityClusters(
  memories: SuggestionMemoryInput[],
  owner?: GraphOwnerInput,
): PersonEntityCluster[] {
  const isOwnerRef = owner ? ownerRefMatcher(owner) : () => false;
  const clusters = new Map<string, PersonEntityCluster>();
  for (const memory of memories) {
    const seen = new Set<string>();
    for (const ref of memory.entityRefs) {
      if (ref.entityType !== "person" || isOwnerRef(ref)) continue;
      const entityKey = `person:${ref.entityId}`;
      if (seen.has(entityKey)) continue;
      seen.add(entityKey);
      const entry = clusters.get(entityKey) ?? {
        entityKey,
        label: "",
        memoryIds: [],
        resourceIds: [],
      };
      if (!entry.label && ref.label?.trim()) entry.label = ref.label.trim();
      entry.memoryIds.push(memory.id);
      if (ref.resourceId && !entry.resourceIds.includes(ref.resourceId)) {
        entry.resourceIds.push(ref.resourceId);
      }
      clusters.set(entityKey, entry);
    }
  }
  return [...clusters.values()]
    .map((cluster) => ({
      ...cluster,
      label: cluster.label || cluster.entityKey.slice("person:".length),
    }))
    .sort((a, b) => b.memoryIds.length - a.memoryIds.length);
}

/**
 * A graph entity only needs a usable name to become a person. Relation and
 * notes remain editable enrichment, but incomplete graph extraction must not
 * hide the person from the suggestion inbox.
 */
export function personDraftIsComplete(draft: AgentPersonDraft): boolean {
  return normalizeName(draft.name).length > 0;
}

/**
 * Existing people whose name overlaps the cluster label or draft name.
 * `exact` means a person with the same normalized full name already exists,
 * so creating another would duplicate the directory entry.
 */
export function matchExistingPeople(
  candidateNames: string[],
  people: { id: string; name: string }[],
): { exact: boolean; matches: { resourceId: string; name: string }[] } {
  const candidateTokenSets = candidateNames
    .map((name) => normalizeName(name))
    .filter(Boolean)
    .map((name) => ({ name, tokens: name.split(" ").filter(Boolean) }));
  const matches: { resourceId: string; name: string }[] = [];
  let exact = false;
  for (const person of people) {
    const personName = normalizeName(person.name);
    if (!personName) continue;
    const personTokens = personName.split(" ").filter(Boolean);
    for (const candidate of candidateTokenSets) {
      if (candidate.name === personName) {
        exact = true;
        matches.push({ resourceId: person.id, name: person.name });
        break;
      }
      const overlap =
        candidate.tokens.every((token) => personTokens.includes(token)) ||
        personTokens.every((token) => candidate.tokens.includes(token));
      if (overlap) {
        matches.push({ resourceId: person.id, name: person.name });
        break;
      }
    }
  }
  return { exact, matches: matches.slice(0, 10) };
}

async function loadOwner(): Promise<GraphOwnerInput | undefined> {
  // Single-admin app: the better-auth user collection holds exactly the owner.
  const ownerDoc = await AgentMemory.db
    .collection("user")
    .findOne<{ _id: unknown; name?: string; email?: string }>(
      {},
      { projection: { _id: 1, name: 1, email: 1 } },
    );
  return ownerDoc?.name && ownerDoc?.email
    ? {
        id: String(ownerDoc._id),
        name: ownerDoc.name,
        email: ownerDoc.email,
      }
    : undefined;
}

export interface GenerateResourceSuggestionsOutcome {
  created: number;
  skipped: number;
  suggestions: IAgentResourceSuggestion[];
}

function entityIdFromKey(entityKey: string): string {
  return entityKey.slice("person:".length);
}

export function resolveAttachedPersonResourceId(
  cluster: PersonEntityCluster,
  existingPersonIds: ReadonlySet<string>,
  acceptedResourceId?: string,
): string | undefined {
  return (
    cluster.resourceIds.find((id) => existingPersonIds.has(id)) ??
    (existingPersonIds.has(entityIdFromKey(cluster.entityKey))
      ? entityIdFromKey(cluster.entityKey)
      : undefined) ??
    (acceptedResourceId && existingPersonIds.has(acceptedResourceId)
      ? acceptedResourceId
      : undefined)
  );
}

export function splitPersonEntityRefs(
  refs: AgentEntityRef[],
  entityId: string,
  splitEntityId: string,
): { entityRefs: AgentEntityRef[]; changed: boolean } {
  let changed = false;
  const entityRefs = refs.map((ref) => {
    if (ref.entityType !== "person" || ref.entityId !== entityId) return ref;
    changed = true;
    return {
      entityType: "person" as const,
      entityId: splitEntityId,
      ...(ref.label ? { label: ref.label } : {}),
    };
  });
  return { entityRefs, changed };
}

/**
 * Materialize the invariant behind the inbox: every non-owner person entity is
 * either attached to a Person record or has already received a suggestion.
 * No model decides which people qualify.
 */
export async function generateResourceSuggestions(
  options: { entityKey?: string } = {},
): Promise<GenerateResourceSuggestionsOutcome> {
  await connectDB();
  const owner = await loadOwner();
  const memories = await AgentMemory.find({
    status: "active",
    "entityRefs.entityType": "person",
  })
    .select("statement entityRefs createdAt")
    .sort({ createdAt: 1 })
    .lean();
  const allClusters = buildPersonEntityClusters(
    memories.map((memory) => ({
      id: memory._id.toString(),
      statement: memory.statement,
      createdAt: memory.createdAt,
      entityRefs: (memory.entityRefs ??
        []) as SuggestionMemoryInput["entityRefs"],
    })),
    owner,
  );

  const priorSuggestions = await AgentResourceSuggestion.find({
    resourceType: "person",
  })
    .select("entityKey status resultingResourceId")
    .lean();
  const priorByEntity = new Map<
    string,
    { status: string; resultingResourceId?: string }[]
  >();
  for (const prior of priorSuggestions) {
    const rows = priorByEntity.get(prior.entityKey) ?? [];
    rows.push({
      status: prior.status,
      resultingResourceId: prior.resultingResourceId,
    });
    priorByEntity.set(prior.entityKey, rows);
  }

  const people = await Person.find()
    .select("name")
    .lean<Pick<ILeanPerson, "_id" | "name">[]>();
  const existingPeople = people.map((person) => ({
    id: String(person._id),
    name: person.name,
  }));
  const existingPersonIds = new Set(existingPeople.map((person) => person.id));

  let skipped = 0;
  const clusters = options.entityKey
    ? allClusters.filter((cluster) => cluster.entityKey === options.entityKey)
    : allClusters;
  if (options.entityKey) {
    if (!clusters[0]) {
      throw new AgentMemoryPolicyError(
        `No active memories reference ${options.entityKey}`,
        "not-found",
      );
    }
  }

  const created: IAgentResourceSuggestion[] = [];
  for (const cluster of clusters) {
    const entityId = entityIdFromKey(cluster.entityKey);
    const prior = priorByEntity.get(cluster.entityKey) ?? [];
    const acceptedResourceId = prior.find(
      (row) => row.status === "accepted" && row.resultingResourceId,
    )?.resultingResourceId;
    const attachedResourceId = resolveAttachedPersonResourceId(
      cluster,
      existingPersonIds,
      acceptedResourceId,
    );
    const existingMatch = matchExistingPeople([cluster.label], existingPeople);
    if (attachedResourceId) {
      await attachPersonResourceToEntity({
        entityId,
        resourceId: attachedResourceId,
        reason: `Attached graph person ${cluster.label} to directory person ${attachedResourceId}`,
      });
      await AgentResourceSuggestion.updateMany(
        { entityKey: cluster.entityKey, status: "pending" },
        {
          $set: {
            status: "accepted",
            resultingResourceId: attachedResourceId,
            decidedAt: new Date(),
          },
        },
      );
      skipped += 1;
      continue;
    }

    // Pending suggestions are already materialized and dismissals remain an
    // explicit user choice. An accepted suggestion whose Person was later
    // deleted does not suppress a replacement: the entity is unattached again.
    if (prior.some((row) => row.status === "pending")) {
      await AgentResourceSuggestion.updateMany(
        { entityKey: cluster.entityKey, status: "pending" },
        {
          $set: {
            entityLabel: cluster.label,
            memoryIds: cluster.memoryIds
              .slice(-MAX_MEMORIES_PER_ENTITY)
              .filter((memoryId) => Types.ObjectId.isValid(memoryId))
              .map((memoryId) => new Types.ObjectId(memoryId)),
            existingResourceMatches: existingMatch.matches,
          },
        },
      );
      skipped += 1;
      continue;
    }
    if (prior.some((row) => row.status === "dismissed")) {
      skipped += 1;
      continue;
    }

    try {
      const doc = await AgentResourceSuggestion.create({
        resourceType: "person",
        entityKey: cluster.entityKey,
        entityLabel: cluster.label,
        draft: {
          name: cluster.label,
          relationToOwner: "",
          notes: "",
        },
        memoryIds: cluster.memoryIds
          .slice(-MAX_MEMORIES_PER_ENTITY)
          .filter((memoryId) => Types.ObjectId.isValid(memoryId))
          .map((memoryId) => new Types.ObjectId(memoryId)),
        confidence: 1,
        reason:
          "This person appears in the memory graph but has no attached people-directory record.",
        existingResourceMatches: existingMatch.matches,
        status: "pending",
        model: DETERMINISTIC_MODEL,
      });
      created.push(doc);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  return { created: created.length, skipped, suggestions: created };
}

export async function processResourceSuggestionJob(
  _job: IAgentMemoryJob,
): Promise<{ created: number; skipped: number }> {
  await connectDB();
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.formation) {
    return { created: 0, skipped: 0 };
  }
  const outcome = await generateResourceSuggestions();
  return { created: outcome.created, skipped: outcome.skipped };
}

export async function scheduleNextResourceSuggestionJob(now = new Date()) {
  await connectDB();
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.formation) {
    return { scheduled: false, reason: "formation-disabled" } as const;
  }
  const activeJob = await AgentMemoryJob.findOne({
    operation: "resource-suggestion",
    status: { $in: ["pending", "leased", "retry"] },
  })
    .select("_id")
    .lean();
  if (activeJob) {
    return { scheduled: false, reason: "active-job" } as const;
  }
  const key = `resource-suggestion:sweep:${now.toISOString().slice(0, 10)}`;
  const existing = await AgentMemoryJob.findOne({ idempotencyKey: key })
    .select("_id")
    .lean();
  if (existing) {
    return { scheduled: false, reason: "already-ran" } as const;
  }
  const job = await AgentMemoryJob.findOneAndUpdate(
    { idempotencyKey: key },
    {
      $setOnInsert: {
        operation: "resource-suggestion",
        evidenceIds: [],
        memoryIds: [],
        status: "pending",
        attempts: 0,
        availableAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return { scheduled: true, jobId: job._id.toString() } as const;
}

async function auditSuggestionDecision(
  suggestion: IAgentResourceSuggestion,
  action: string,
  reason: string,
  metadata: Record<string, unknown>,
) {
  await AgentAuditEvent.create({
    auditId: randomUUID(),
    action,
    actor: "user",
    targetType: "resource-suggestion",
    targetId: suggestion._id.toString(),
    reason,
    metadata,
    contentRedacted: false,
    occurredAt: new Date(),
  });
}

/**
 * Find the owner's own entry in the people directory so the accepted person
 * can be linked to it. Matching mirrors the graph's owner detection.
 */
function findOwnerPersonId(
  owner: GraphOwnerInput | undefined,
  people: Pick<ILeanPerson, "_id" | "name" | "email">[],
): string | null {
  if (!owner) return null;
  const isOwnerRef = ownerRefMatcher(owner);
  const match = people.find((person) =>
    isOwnerRef({
      entityType: "person",
      entityId: person.email ?? String(person._id),
      label: person.name,
    }),
  );
  return match ? String(match._id) : null;
}

export async function acceptResourceSuggestion(options: {
  suggestionId: string;
  reason: string;
  draftOverride?: Partial<AgentPersonDraft>;
}): Promise<IAgentResourceSuggestion> {
  await connectDB();
  const suggestion = await AgentResourceSuggestion.findById(
    options.suggestionId,
  );
  if (!suggestion) {
    throw new AgentMemoryPolicyError("Suggestion not found", "not-found");
  }
  if (suggestion.status !== "pending") {
    throw new AgentMemoryPolicyError(
      `Suggestion is already ${suggestion.status}`,
      "conflict",
    );
  }
  const override = Object.fromEntries(
    Object.entries(options.draftOverride ?? {}).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const draft = agentPersonDraftSchema.parse({
    ...suggestion.toObject().draft,
    ...override,
  });
  if (!personDraftIsComplete(draft)) {
    throw new AgentMemoryPolicyError(
      "Draft is incomplete: a person needs a name",
      "conflict",
    );
  }
  if (findDeniedContent(draft).length > 0) {
    throw new AgentMemoryPolicyError(
      "Draft contains denied content",
      "denied-content",
    );
  }

  const owner = await loadOwner();
  const people = await Person.find()
    .select("name email")
    .lean<Pick<ILeanPerson, "_id" | "name" | "email">[]>();
  const ownerPersonId = findOwnerPersonId(owner, people);

  // Atomically claim the pending suggestion before creating the person so two
  // concurrent accepts can't each create a person for the same suggestion.
  const claimed = await AgentResourceSuggestion.findOneAndUpdate(
    { _id: suggestion._id, status: "pending" },
    { $set: { status: "accepted", draft, decidedAt: new Date() } },
    { new: true },
  );
  if (!claimed) {
    const current = await AgentResourceSuggestion.findById(options.suggestionId)
      .select("status")
      .lean();
    throw new AgentMemoryPolicyError(
      `Suggestion is already ${current?.status ?? "resolved"}`,
      "conflict",
    );
  }

  const notes =
    !ownerPersonId && draft.relationToOwner
      ? [
          draft.notes,
          `Relation to ${OWNER_REFERENCE}: ${draft.relationToOwner}`,
        ]
          .filter(Boolean)
          .join("\n\n")
      : draft.notes;
  let person: Awaited<ReturnType<typeof createPerson>>;
  try {
    person = await createPerson({
      name: draft.name,
      notes,
      placeMet: draft.placeMet,
      email: draft.email,
      phone: draft.phone,
      website: draft.website,
      relations:
        ownerPersonId && draft.relationToOwner
          ? [{ personId: ownerPersonId, reason: draft.relationToOwner }]
          : [],
    });
  } catch (error) {
    // Release the claim so a failed creation can be retried.
    await AgentResourceSuggestion.updateOne(
      { _id: claimed._id, status: "accepted" },
      { $set: { status: "pending" }, $unset: { decidedAt: "" } },
    );
    throw error;
  }
  if (!person) {
    await AgentResourceSuggestion.updateOne(
      { _id: claimed._id, status: "accepted" },
      { $set: { status: "pending" }, $unset: { decidedAt: "" } },
    );
    throw new Error("Person creation from suggestion failed");
  }

  claimed.set({ resultingResourceId: person._id });
  await claimed.save();
  await attachPersonResourceToEntity({
    entityId: entityIdFromKey(claimed.entityKey),
    resourceId: person._id,
    reason: `Created and attached ${draft.name} from resource suggestion ${claimed._id}`,
  });
  await auditSuggestionDecision(
    claimed,
    "resource-suggestion.accept",
    options.reason,
    { personId: person._id, entityKey: claimed.entityKey },
  );
  return claimed;
}

export async function attachExistingPersonSuggestion(options: {
  suggestionId: string;
  resourceId: string;
  reason: string;
}): Promise<IAgentResourceSuggestion> {
  await connectDB();
  if (!Types.ObjectId.isValid(options.resourceId)) {
    throw new AgentMemoryPolicyError("Existing person not found", "not-found");
  }
  const [suggestion, person] = await Promise.all([
    AgentResourceSuggestion.findById(options.suggestionId),
    Person.findById(options.resourceId).select("_id name").lean(),
  ]);
  if (!suggestion) {
    throw new AgentMemoryPolicyError("Suggestion not found", "not-found");
  }
  if (!person) {
    throw new AgentMemoryPolicyError("Existing person not found", "not-found");
  }
  if (suggestion.status !== "pending") {
    throw new AgentMemoryPolicyError(
      `Suggestion is already ${suggestion.status}`,
      "conflict",
    );
  }

  const claimed = await AgentResourceSuggestion.findOneAndUpdate(
    { _id: suggestion._id, status: "pending" },
    {
      $set: {
        status: "accepted",
        resultingResourceId: String(person._id),
        decidedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!claimed) {
    throw new AgentMemoryPolicyError(
      "Suggestion was already resolved",
      "conflict",
    );
  }

  await attachPersonResourceToEntity({
    entityId: entityIdFromKey(claimed.entityKey),
    resourceId: String(person._id),
    reason: `Attached existing person ${person.name} from resource suggestion ${claimed._id}`,
  });
  await auditSuggestionDecision(
    claimed,
    "resource-suggestion.attach",
    options.reason,
    {
      personId: String(person._id),
      entityKey: claimed.entityKey,
      existingPerson: true,
    },
  );
  return claimed;
}

export async function dismissResourceSuggestion(options: {
  suggestionId: string;
  reason: string;
}): Promise<IAgentResourceSuggestion> {
  await connectDB();
  const suggestion = await AgentResourceSuggestion.findById(
    options.suggestionId,
  );
  if (!suggestion) {
    throw new AgentMemoryPolicyError("Suggestion not found", "not-found");
  }
  if (suggestion.status === "dismissed") return suggestion;
  if (suggestion.status !== "pending") {
    throw new AgentMemoryPolicyError(
      `Suggestion is already ${suggestion.status}`,
      "conflict",
    );
  }
  suggestion.set({ status: "dismissed", decidedAt: new Date() });
  await suggestion.save();
  await auditSuggestionDecision(
    suggestion,
    "resource-suggestion.dismiss",
    options.reason,
    { entityKey: suggestion.entityKey },
  );
  return suggestion;
}

export async function splitMemoryFromResourceSuggestion(options: {
  suggestionId: string;
  memoryId: string;
  reason: string;
}): Promise<IAgentResourceSuggestion> {
  await connectDB();
  if (
    !Types.ObjectId.isValid(options.suggestionId) ||
    !Types.ObjectId.isValid(options.memoryId)
  ) {
    throw new AgentMemoryPolicyError("Suggestion not found", "not-found");
  }
  const suggestion = await AgentResourceSuggestion.findById(
    options.suggestionId,
  );
  if (!suggestion) {
    throw new AgentMemoryPolicyError("Suggestion not found", "not-found");
  }
  if (suggestion.status !== "pending") {
    throw new AgentMemoryPolicyError(
      `Suggestion is already ${suggestion.status}`,
      "conflict",
    );
  }
  if (suggestion.memoryIds.length <= 1) {
    throw new AgentMemoryPolicyError(
      "A suggestion must retain at least one related memory",
      "conflict",
    );
  }
  if (
    !suggestion.memoryIds.some(
      (memoryId) => memoryId.toString() === options.memoryId,
    )
  ) {
    throw new AgentMemoryPolicyError(
      "Memory is not related to this suggestion",
      "not-found",
    );
  }

  const entityId = entityIdFromKey(suggestion.entityKey);
  const memory = await AgentMemory.findOne({
    _id: options.memoryId,
    status: "active",
    entityRefs: {
      $elemMatch: {
        entityType: "person",
        entityId,
        resourceId: { $exists: false },
      },
    },
  });
  if (!memory) {
    throw new AgentMemoryPolicyError(
      "Related memory is no longer available",
      "not-found",
    );
  }

  const splitEntityId = `person-split-${memory._id.toString()}`;
  const split = splitPersonEntityRefs(
    memory.entityRefs as AgentEntityRef[],
    entityId,
    splitEntityId,
  );
  if (!split.changed) {
    throw new AgentMemoryPolicyError(
      "Related memory no longer references this person",
      "conflict",
    );
  }
  await replaceMemoryEntityRefs({
    memoryId: memory._id.toString(),
    entityRefs: split.entityRefs,
    reason: options.reason,
  });
  await AgentResourceSuggestion.updateOne(
    { _id: suggestion._id, status: "pending" },
    { $pull: { memoryIds: memory._id } },
  );
  await generateResourceSuggestions({
    entityKey: `person:${splitEntityId}`,
  });
  await auditSuggestionDecision(
    suggestion,
    "resource-suggestion.split-memory",
    options.reason,
    {
      memoryId: memory._id.toString(),
      previousEntityKey: suggestion.entityKey,
      splitEntityKey: `person:${splitEntityId}`,
    },
  );

  const updated = await AgentResourceSuggestion.findById(suggestion._id);
  if (!updated) {
    throw new AgentMemoryPolicyError("Suggestion not found", "not-found");
  }
  return updated;
}

export async function listResourceSuggestions(status?: string) {
  await connectDB();
  const filter: { status?: IAgentResourceSuggestion["status"] } = {};
  if (status === "pending" || status === "accepted" || status === "dismissed") {
    filter.status = status;
  }
  const [suggestions, pending, accepted, dismissed] = await Promise.all([
    AgentResourceSuggestion.find(filter).sort({ createdAt: -1 }).limit(200),
    AgentResourceSuggestion.countDocuments({ status: "pending" }),
    AgentResourceSuggestion.countDocuments({ status: "accepted" }),
    AgentResourceSuggestion.countDocuments({ status: "dismissed" }),
  ]);
  return {
    suggestions,
    stats: {
      pending,
      accepted,
      dismissed,
      total: pending + accepted + dismissed,
    },
  };
}

export async function getResourceSuggestionMemories(suggestionId: string) {
  await connectDB();
  const suggestion = await AgentResourceSuggestion.findById(suggestionId)
    .select("memoryIds")
    .lean();
  if (!suggestion) {
    throw new AgentMemoryPolicyError("Suggestion not found", "not-found");
  }
  const memories = await AgentMemory.find({
    _id: { $in: suggestion.memoryIds },
  });
  const byId = new Map(
    memories.map((memory) => [memory._id.toString(), memory]),
  );
  return suggestion.memoryIds
    .map((memoryId) => byId.get(memoryId.toString()))
    .filter((memory): memory is NonNullable<typeof memory> => Boolean(memory));
}
