import type { AgentEntityRef } from "@repo/schemas";
import mongoose from "mongoose";
import { replaceMemoryEntityRefs } from "@/lib/agent-memory/governance";
import {
  type GraphOwnerInput,
  ownerRefMatcher,
} from "@/lib/agent-memory/graph";
import { buildPersonEntityClusters } from "@/lib/agent-memory/resource-suggestions";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentResourceSuggestion } from "@/models/AgentResourceSuggestion";
import { Person } from "@/models/Person";

interface PersonIdentity {
  id: string;
  name: string;
  email?: string;
}

export interface PersonIdentityContext {
  owner: GraphOwnerInput;
  ownerPersonId?: string;
  peopleById: ReadonlyMap<string, PersonIdentity>;
  peopleByNormalizedName: ReadonlyMap<string, PersonIdentity>;
  personIdByEvidenceEventId: ReadonlyMap<string, string>;
}

interface MigrationOptions {
  execute: boolean;
}

function parseOptions(args: string[]): MigrationOptions {
  const unknown = args.filter(
    (argument) => argument !== "--execute" && argument !== "--dry-run",
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown.join(", ")}`);
  }
  return { execute: args.includes("--execute") };
}

export function normalizePersonIdentity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function canonicalPersonRef(
  person: PersonIdentity,
  context: PersonIdentityContext,
): AgentEntityRef {
  if (person.id === context.ownerPersonId) {
    return {
      entityType: "person",
      entityId: "owner",
      label: person.name,
      resourceId: person.id,
    };
  }
  return {
    entityType: "person",
    entityId: person.id,
    label: person.name,
    resourceId: person.id,
  };
}

function resolvedPerson(
  ref: AgentEntityRef,
  context: PersonIdentityContext,
): PersonIdentity | undefined {
  const sourcePersonId = context.personIdByEvidenceEventId.get(ref.entityId);
  if (sourcePersonId) return context.peopleById.get(sourcePersonId);
  if (ref.resourceId) {
    const attached = context.peopleById.get(ref.resourceId);
    if (attached) return attached;
  }
  const direct = context.peopleById.get(ref.entityId);
  if (direct) return direct;
  if (ref.label) {
    const byLabel = context.peopleByNormalizedName.get(
      normalizePersonIdentity(ref.label),
    );
    if (byLabel) return byLabel;
  }
  return context.peopleByNormalizedName.get(
    normalizePersonIdentity(ref.entityId),
  );
}

export function canonicalizePersonEntityRefs(
  refs: AgentEntityRef[],
  context: PersonIdentityContext,
): AgentEntityRef[] {
  const isOwnerRef = ownerRefMatcher(context.owner);
  const normalized = new Map<string, AgentEntityRef>();
  for (const ref of refs) {
    let next = ref;
    if (ref.entityType === "person") {
      const person = resolvedPerson(ref, context);
      if (person) {
        next = canonicalPersonRef(person, context);
      } else if (isOwnerRef(ref)) {
        const ownerPerson = context.ownerPersonId
          ? context.peopleById.get(context.ownerPersonId)
          : undefined;
        next = ownerPerson
          ? canonicalPersonRef(ownerPerson, context)
          : {
              entityType: "person",
              entityId: "owner",
              label: context.owner.name,
            };
      }
    }
    const key = `${next.entityType}:${next.entityId}`;
    const existing = normalized.get(key);
    normalized.set(key, {
      ...existing,
      ...next,
      label: existing?.label ?? next.label,
      resourceId: existing?.resourceId ?? next.resourceId,
    });
  }
  return [...normalized.values()];
}

function refsEqual(left: AgentEntityRef[], right: AgentEntityRef[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadContext(): Promise<PersonIdentityContext> {
  const ownerDoc = await AgentMemory.db
    .collection("user")
    .findOne<{ _id: unknown; name?: string; email?: string }>(
      {},
      { projection: { _id: 1, name: 1, email: 1 } },
    );
  if (!ownerDoc?.name || !ownerDoc.email) {
    throw new Error("Cannot migrate person identities without an auth owner");
  }
  const people = await Person.find()
    .select("name email")
    .lean<{ _id: unknown; name: string; email?: string }[]>();
  const identities = people.map((person) => ({
    id: String(person._id),
    name: person.name,
    email: person.email,
  }));
  const peopleById = new Map(identities.map((person) => [person.id, person]));
  const nameBuckets = new Map<string, PersonIdentity[]>();
  for (const person of identities) {
    const key = normalizePersonIdentity(person.name);
    const bucket = nameBuckets.get(key) ?? [];
    bucket.push(person);
    nameBuckets.set(key, bucket);
  }
  const peopleByNormalizedName = new Map(
    [...nameBuckets].flatMap(([name, matches]) =>
      matches.length === 1 ? [[name, matches[0]!] as const] : [],
    ),
  );
  const normalizedOwnerEmail = ownerDoc.email.trim().toLowerCase();
  const ownerPerson =
    identities.find(
      (person) => person.email?.trim().toLowerCase() === normalizedOwnerEmail,
    ) ?? peopleByNormalizedName.get(normalizePersonIdentity(ownerDoc.name));

  const personEvidence = await AgentEvidenceEvent.find({
    sourceType: "person",
    "sourceRef.entityType": "person",
  })
    .select("eventId sourceRef.entityId")
    .lean<{ eventId: string; sourceRef: { entityId: string } }[]>();

  return {
    owner: {
      id: String(ownerDoc._id),
      name: ownerDoc.name,
      email: ownerDoc.email,
    },
    ownerPersonId: ownerPerson?.id,
    peopleById,
    peopleByNormalizedName,
    personIdByEvidenceEventId: new Map(
      personEvidence.map((event) => [event.eventId, event.sourceRef.entityId]),
    ),
  };
}

async function pendingSuggestionIdsToRemove(
  context: PersonIdentityContext,
): Promise<{ id: string; entityKey: string; entityLabel: string }[]> {
  const memories = await AgentMemory.find({
    status: "active",
    "entityRefs.entityType": "person",
  })
    .select("entityRefs createdAt statement")
    .sort({ createdAt: 1 })
    .lean();
  const clusters = buildPersonEntityClusters(
    memories.map((memory) => ({
      id: String(memory._id),
      statement: memory.statement,
      createdAt: memory.createdAt,
      entityRefs: canonicalizePersonEntityRefs(memory.entityRefs, context),
    })),
    context.owner,
  );
  const existingPersonIds = new Set(context.peopleById.keys());
  const validUnattachedEntityKeys = new Set(
    clusters
      .filter(
        (cluster) =>
          !cluster.resourceIds.some((id) => existingPersonIds.has(id)) &&
          !existingPersonIds.has(cluster.entityKey.slice("person:".length)),
      )
      .map((cluster) => cluster.entityKey),
  );
  const pending = await AgentResourceSuggestion.find({
    status: "pending",
    resourceType: "person",
  })
    .select("_id entityKey entityLabel")
    .lean();
  return pending
    .filter(
      (suggestion) => !validUnattachedEntityKeys.has(suggestion.entityKey),
    )
    .map((suggestion) => ({
      id: String(suggestion._id),
      entityKey: suggestion.entityKey,
      entityLabel: suggestion.entityLabel,
    }));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await connectDB();
  const context = await loadContext();
  const memories = await AgentMemory.find({ status: { $ne: "deleted" } })
    .select("entityRefs status")
    .sort({ _id: 1 })
    .lean();
  const changes = memories.flatMap((memory) => {
    const before = memory.entityRefs ?? [];
    const after = canonicalizePersonEntityRefs(before, context);
    return refsEqual(before, after)
      ? []
      : [
          {
            memoryId: String(memory._id),
            status: memory.status,
            before,
            after,
          },
        ];
  });

  console.log(
    JSON.stringify(
      {
        mode: options.execute ? "execute" : "dry-run",
        owner: {
          authId: context.owner.id,
          name: context.owner.name,
          directoryPersonId: context.ownerPersonId ?? null,
        },
        people: context.peopleById.size,
        personEvidenceEvents: context.personIdByEvidenceEventId.size,
        memoryRevisionsPlanned: changes.length,
        examples: changes.slice(0, 20),
      },
      null,
      2,
    ),
  );

  if (!options.execute) {
    const staleSuggestions = await pendingSuggestionIdsToRemove(context);
    console.log(
      JSON.stringify(
        {
          pendingSuggestionsPlannedForRemoval: staleSuggestions.length,
          staleSuggestions,
        },
        null,
        2,
      ),
    );
    return;
  }

  let revised = 0;
  for (const change of changes) {
    await replaceMemoryEntityRefs({
      memoryId: change.memoryId,
      entityRefs: change.after,
      reason:
        "Canonicalized person identities from evidence, owner aliases, and people-directory records",
    });
    revised += 1;
  }
  const staleSuggestions = await pendingSuggestionIdsToRemove(context);
  const deleted =
    staleSuggestions.length > 0
      ? await AgentResourceSuggestion.deleteMany({
          _id: { $in: staleSuggestions.map((suggestion) => suggestion.id) },
          status: "pending",
        })
      : { deletedCount: 0 };
  console.log(
    JSON.stringify(
      {
        completed: true,
        memoryRevisionsCreated: revised,
        pendingSuggestionsRemoved: deleted.deletedCount,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } finally {
    await mongoose.disconnect();
  }
}
