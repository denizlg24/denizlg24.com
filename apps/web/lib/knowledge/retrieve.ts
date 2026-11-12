import {
  type KnowledgeHit,
  type KnowledgeRetrieveInput,
  type KnowledgeRetrieveResponse,
  knowledgeRetrieveInputSchema,
} from "@repo/schemas";
import mongoose from "mongoose";
import { scoreToCosine } from "@/lib/agent-memory/similarity";
import { connectDB } from "@/lib/mongodb";
import { resolveNotebookSourceKeys } from "@/lib/study/notebook-sources";
import {
  type ILeanKnowledgeChunk,
  KnowledgeChunk,
} from "@/models/KnowledgeChunk";
import { KnowledgeSourceVector } from "@/models/KnowledgeSourceVector";
import { archivedNoteKeys } from "./catalog";
import { embedKnowledgeQuery } from "./embed";
import { fuseRanks } from "./fusion";
import { chunkToHit } from "./serialize";
import { KNOWLEDGE_VECTOR_CONFIG } from "./vector-config";

export const CANDIDATE_LIMIT = 40;
const CANDIDATE_MULTIPLIER = 20;
/** Past this a `$in` list is slower than filtering the candidates afterwards. */
const MAX_FILTER_KEYS = 2_000;
const HIDDEN_OVERFETCH = 3;

type KeyFilter = { $in: string[] } | { $nin: string[] };

interface Restriction {
  filter?: KeyFilter;
  /** Applied to candidates when the scope was too large to filter inside the stage. */
  allowed?: Set<string>;
  /** Archived sources too many for a vector-stage filter: dropped from its candidates instead. */
  hidden?: Set<string>;
  /** The lexical stage takes the full exclusion list at any size. */
  lexicalFilter?: KeyFilter;
  sources: number | null;
}

async function resolveRestriction(
  input: ReturnType<typeof knowledgeRetrieveInputSchema.parse>,
): Promise<Restriction> {
  const archived = input.includeArchived ? [] : await archivedNoteKeys();
  let scoped: string[] | null = null;
  if (input.notebookId) {
    scoped = await resolveNotebookSourceKeys(input.notebookId);
  }
  if (input.sourceKeys) {
    const requested = new Set(input.sourceKeys);
    scoped = scoped
      ? scoped.filter((key) => requested.has(key))
      : [...requested];
  }
  if (!scoped) {
    if (archived.length === 0) return { sources: null };
    if (archived.length <= MAX_FILTER_KEYS) {
      return { filter: { $nin: archived }, sources: null };
    }
    return {
      hidden: new Set(archived),
      lexicalFilter: { $nin: archived },
      sources: null,
    };
  }
  const hidden = new Set(archived);
  const keys = scoped.filter((key) => !hidden.has(key));
  if (keys.length > MAX_FILTER_KEYS) {
    return { allowed: new Set(keys), sources: keys.length };
  }
  return { filter: { $in: keys }, sources: keys.length };
}

function stageFilter(filter: KeyFilter | undefined) {
  return {
    model: KNOWLEDGE_VECTOR_CONFIG.model,
    status: "active",
    ...(filter ? { sourceKey: filter } : {}),
  };
}

async function vectorCandidates(
  query: string,
  restriction: Restriction,
): Promise<string[]> {
  const vector = await embedKnowledgeQuery(query);
  const limit = restriction.hidden
    ? CANDIDATE_LIMIT * HIDDEN_OVERFETCH
    : CANDIDATE_LIMIT;
  const rows = await KnowledgeChunk.aggregate<{
    _id: mongoose.Types.ObjectId;
    sourceKey: string;
    score: number;
  }>([
    {
      $vectorSearch: {
        index: KNOWLEDGE_VECTOR_CONFIG.indexName,
        path: KNOWLEDGE_VECTOR_CONFIG.path,
        queryVector: vector,
        numCandidates: limit * CANDIDATE_MULTIPLIER,
        limit,
        filter: stageFilter(restriction.filter),
      },
    },
    { $project: { sourceKey: 1, score: { $meta: "vectorSearchScore" } } },
  ]);
  return rows
    .filter(
      (row) =>
        (!restriction.allowed || restriction.allowed.has(row.sourceKey)) &&
        !restriction.hidden?.has(row.sourceKey),
    )
    .map((row) => ({ id: String(row._id), cosine: scoreToCosine(row.score) }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, CANDIDATE_LIMIT)
    .map((row) => row.id);
}

async function lexicalCandidates(
  query: string,
  restriction: Restriction,
): Promise<string[]> {
  const rows = await KnowledgeChunk.aggregate<{
    _id: mongoose.Types.ObjectId;
    sourceKey: string;
  }>([
    {
      $match: {
        $text: { $search: query },
        ...stageFilter(restriction.lexicalFilter ?? restriction.filter),
      },
    },
    { $addFields: { textScore: { $meta: "textScore" } } },
    { $sort: { textScore: -1 } },
    { $limit: CANDIDATE_LIMIT },
    { $project: { sourceKey: 1 } },
  ]);
  return rows
    .filter(
      (row) => !restriction.allowed || restriction.allowed.has(row.sourceKey),
    )
    .map((row) => String(row._id));
}

export async function retrieveKnowledge(
  rawInput: KnowledgeRetrieveInput,
): Promise<KnowledgeRetrieveResponse> {
  const input = knowledgeRetrieveInputSchema.parse(rawInput);
  await connectDB();
  const restriction = await resolveRestriction(input);
  if (
    restriction.filter &&
    "$in" in restriction.filter &&
    restriction.filter.$in.length === 0
  ) {
    return { hits: [], sourceCount: 0 };
  }

  const [vectorIds, lexicalIds] = await Promise.all([
    vectorCandidates(input.query, restriction).catch((error) => {
      // An unbuilt or still-building Atlas index must not take lexical search down with it.
      console.error("[Knowledge] Vector search failed; lexical only", error);
      return [] as string[];
    }),
    lexicalCandidates(input.query, restriction).catch((error) => {
      console.error("[Knowledge] Lexical search failed", error);
      return [] as string[];
    }),
  ]);
  const fused = fuseRanks(vectorIds, lexicalIds, input.k);
  if (fused.length === 0)
    return { hits: [], sourceCount: restriction.sources ?? 0 };

  const chunks = await KnowledgeChunk.find({
    _id: { $in: fused.map((entry) => new mongoose.Types.ObjectId(entry.id)) },
  })
    .select("-vector -text")
    .lean<ILeanKnowledgeChunk[]>()
    .exec();
  const byId = new Map(chunks.map((chunk) => [String(chunk._id), chunk]));
  const hits: KnowledgeHit[] = fused.flatMap((entry) => {
    const chunk = byId.get(entry.id);
    return chunk ? [chunkToHit(chunk, entry)] : [];
  });
  const sourceCount =
    restriction.sources ??
    (await KnowledgeSourceVector.countDocuments({
      model: KNOWLEDGE_VECTOR_CONFIG.model,
    }).exec());
  return { hits, sourceCount };
}
