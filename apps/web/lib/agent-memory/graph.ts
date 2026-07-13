import type { AgentMemoryGraphLink, AgentMemoryGraphNode } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";

const MAX_GRAPH_MEMORIES = 5_000;
const MAX_GRAPH_EMBEDDINGS = 2_000;
const SIMILARITY_TOP_K = 3;
const MIN_SIMILARITY = 0.35;
const MIN_ENTITY_MEMBERS = 2;
const LABEL_LENGTH = 140;

export interface GraphMemoryInput {
  id: string;
  statement: string;
  memoryType: string;
  status: string;
  confidence: number;
  importance: number;
  entityRefs: { entityType: string; entityId: string; label?: string }[];
  contradictionIds: string[];
  supersedesMemoryId?: string;
}

export interface GraphEmbeddingInput {
  memoryId: string;
  vector: number[];
}

export interface GraphOwnerInput {
  name: string;
  email: string;
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

/**
 * Owner person-refs are scattered across ids/labels ("deniz-gunes", "deniz",
 * the email, "user" with a full-name label, accented variants). A ref is the
 * owner when its id or label matches the email, or its tokens are all owner
 * name tokens and include the first name.
 */
export function ownerRefMatcher(
  owner: GraphOwnerInput,
): (ref: { entityType: string; entityId: string; label?: string }) => boolean {
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
  return (ref) =>
    ref.entityType === "person" &&
    (matchesValue(ref.entityId) || matchesValue(ref.label));
}

function normalize(vector: number[]): Float64Array {
  const out = new Float64Array(vector.length);
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vector.length; i += 1) out[i] = (vector[i] ?? 0) / norm;
  return out;
}

export function similarityLinks(
  embeddings: GraphEmbeddingInput[],
  options: { topK?: number; minSimilarity?: number } = {},
): AgentMemoryGraphLink[] {
  const topK = options.topK ?? SIMILARITY_TOP_K;
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;
  const normalized = embeddings.map((embedding) => ({
    memoryId: embedding.memoryId,
    vector: normalize(embedding.vector),
  }));

  const byPair = new Map<string, AgentMemoryGraphLink>();
  for (let i = 0; i < normalized.length; i += 1) {
    const left = normalized[i];
    if (!left) continue;
    const neighbors: { memoryId: string; similarity: number }[] = [];
    for (let j = 0; j < normalized.length; j += 1) {
      if (i === j) continue;
      const right = normalized[j];
      if (!right || right.vector.length !== left.vector.length) continue;
      let dot = 0;
      for (let d = 0; d < left.vector.length; d += 1) {
        dot += (left.vector[d] ?? 0) * (right.vector[d] ?? 0);
      }
      if (dot >= minSimilarity) {
        neighbors.push({ memoryId: right.memoryId, similarity: dot });
      }
    }
    neighbors.sort((a, b) => b.similarity - a.similarity);
    for (const neighbor of neighbors.slice(0, topK)) {
      const [source, target] = [left.memoryId, neighbor.memoryId].sort();
      if (!source || !target) continue;
      const key = `${source}:${target}`;
      const existing = byPair.get(key);
      if (!existing || existing.strength < neighbor.similarity) {
        byPair.set(key, {
          source,
          target,
          type: "similar",
          strength: Math.min(1, neighbor.similarity),
        });
      }
    }
  }
  return [...byPair.values()].sort((a, b) =>
    `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`),
  );
}

export function buildAgentMemoryGraph(
  memories: GraphMemoryInput[],
  embeddings: GraphEmbeddingInput[],
  owner?: GraphOwnerInput,
): {
  nodes: AgentMemoryGraphNode[];
  links: AgentMemoryGraphLink[];
  embeddedCount: number;
} {
  const memoryIds = new Set(memories.map((memory) => memory.id));
  const embedded = embeddings.filter((embedding) =>
    memoryIds.has(embedding.memoryId),
  );
  const embeddedIds = new Set(embedded.map((embedding) => embedding.memoryId));

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
  }));

  const links: AgentMemoryGraphLink[] = similarityLinks(embedded);
  const linkKeys = new Set(
    links.map((link) => `${link.type}:${link.source}:${link.target}`),
  );
  const pushLink = (link: AgentMemoryGraphLink) => {
    const [source, target] = [link.source, link.target].sort();
    if (!source || !target || source === target) return;
    const key = `${link.type}:${source}:${target}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ ...link, source, target });
  };

  const isOwnerRef = owner ? ownerRefMatcher(owner) : () => false;
  const entityMembers = new Map<
    string,
    { entityType: string; label: string; memberIds: string[] }
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
      entry.memberIds.push(memory.id);
      entityMembers.set(id, entry);
    }
  }
  if (owner && !entityMembers.has(OWNER_NODE_ID)) {
    entityMembers.set(OWNER_NODE_ID, {
      entityType: "person",
      label: owner.name,
      memberIds: [],
    });
  }
  for (const [id, entry] of [...entityMembers.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const isOwnerNode = id === OWNER_NODE_ID;
    if (!isOwnerNode && entry.memberIds.length < MIN_ENTITY_MEMBERS) continue;
    const label = isOwnerNode
      ? (owner?.name ?? entry.label)
      : entry.label || id.split(":").slice(2).join(":");
    nodes.push({
      id,
      kind: "entity",
      label:
        label.length > LABEL_LENGTH
          ? `${label.slice(0, LABEL_LENGTH)}…`
          : label,
      entityType: entry.entityType,
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

  return { nodes, links, embeddedCount: embedded.length };
}

export async function loadAgentMemoryGraph() {
  await connectDB();
  // Single-admin app: the better-auth user collection holds exactly the owner.
  const ownerDoc = await AgentMemory.db
    .collection("user")
    .findOne<{ name?: string; email?: string }>(
      {},
      { projection: { name: 1, email: 1 } },
    );
  const owner: GraphOwnerInput | undefined =
    ownerDoc?.name && ownerDoc?.email
      ? { name: ownerDoc.name, email: ownerDoc.email }
      : undefined;
  const memories = await AgentMemory.find({ status: { $ne: "deleted" } })
    .select(
      "statement memoryType status confidence importance entityRefs contradictionIds supersedesMemoryId",
    )
    .sort({ createdAt: 1 })
    .limit(MAX_GRAPH_MEMORIES)
    .lean();

  const embeddingDocs = await AgentMemoryEmbedding.find({
    memoryId: { $in: memories.map((memory) => memory._id) },
  })
    .select("+vector")
    .sort({ createdAt: 1 })
    .limit(MAX_GRAPH_EMBEDDINGS)
    .lean();
  // Ascending order + map overwrite keeps only the latest vector per memory.
  const latestByMemory = new Map<string, number[]>();
  for (const doc of embeddingDocs) {
    latestByMemory.set(doc.memoryId.toString(), doc.vector);
  }

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
    })),
    [...latestByMemory.entries()].map(([memoryId, vector]) => ({
      memoryId,
      vector,
    })),
    owner,
  );

  return { ...graph, generatedAt: new Date().toISOString() };
}
