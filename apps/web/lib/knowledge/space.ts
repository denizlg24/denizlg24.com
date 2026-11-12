import {
  type KnowledgeSourceKey,
  type KnowledgeSpaceNeighbor,
  type KnowledgeSpaceNode,
  type KnowledgeSpaceResponse,
  parseKnowledgeSourceKey,
} from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { resolveNotebookSourceKeys } from "@/lib/study/notebook-sources";
import { Course } from "@/models/Course";
import { KnowledgeProjection } from "@/models/KnowledgeProjection";
import { KnowledgeSourceVector } from "@/models/KnowledgeSourceVector";
import { Note } from "@/models/Note";
import { StudyDocument } from "@/models/StudyDocument";
import { VoiceNote } from "@/models/VoiceNote";
import { archivedNoteKeys, countSources } from "./catalog";
import {
  computeNeighbors,
  layoutSourceVectors,
  type SourceVectorMeta,
  spaceInputHash,
  type VectorItem,
} from "./projection-math";
import { queueKnowledgeProjectionJob } from "./queue";
import { drainKnowledgeJobsSoon } from "./reindex";
import { KNOWLEDGE_VECTOR_CONFIG } from "./vector-config";

const MAX_NEIGHBORS_PER_NODE = 5;

export function scopeOf(notebookId?: string): string {
  return notebookId ? `notebook:${notebookId}` : "all";
}

interface ScopeFilter {
  sourceKey?: { $in: string[] } | { $nin: string[] };
}

async function scopeFilter(notebookId?: string): Promise<ScopeFilter> {
  const archived = await archivedNoteKeys();
  if (!notebookId) {
    return archived.length > 0 ? { sourceKey: { $nin: archived } } : {};
  }
  const keys = await resolveNotebookSourceKeys(notebookId);
  const hidden = new Set<string>(archived);
  return { sourceKey: { $in: keys.filter((key) => !hidden.has(key)) } };
}

async function loadMetas(filter: ScopeFilter): Promise<SourceVectorMeta[]> {
  const rows = await KnowledgeSourceVector.find({
    model: KNOWLEDGE_VECTOR_CONFIG.model,
    ...filter,
  })
    .select("sourceKey updatedAt chunkCount")
    .lean<
      Array<{
        sourceKey: KnowledgeSourceKey;
        updatedAt: Date;
        chunkCount: number;
      }>
    >()
    .exec();
  return rows.map((row) => ({
    sourceKey: row.sourceKey,
    updatedAt: row.updatedAt,
    chunkCount: row.chunkCount,
  }));
}

interface NodeMetadata {
  title: string;
  groupIds: string[];
  courseIds: string[];
}

async function loadNodeMetadata(
  keys: KnowledgeSourceKey[],
): Promise<Map<KnowledgeSourceKey, NodeMetadata>> {
  const ids = {
    note: [] as string[],
    "voice-note": [] as string[],
    document: [] as string[],
  };
  for (const key of keys) {
    const parsed = parseKnowledgeSourceKey(key);
    if (parsed) ids[parsed.kind].push(parsed.id);
  }
  const toObjectIds = (list: string[]) =>
    list.map((id) => new mongoose.Types.ObjectId(id));
  const [notes, voiceNotes, documents, courses] = await Promise.all([
    Note.find({ _id: { $in: toObjectIds(ids.note) } })
      .select("title groupIds")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          title: string;
          groupIds?: mongoose.Types.ObjectId[];
        }>
      >()
      .exec(),
    VoiceNote.find({ _id: { $in: toObjectIds(ids["voice-note"]) } })
      .select("title")
      .lean<Array<{ _id: mongoose.Types.ObjectId; title: string }>>()
      .exec(),
    StudyDocument.find({ _id: { $in: toObjectIds(ids.document) } })
      .select("title courseId")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          title: string;
          courseId?: mongoose.Types.ObjectId;
        }>
      >()
      .exec(),
    Course.find({ noteIds: { $in: toObjectIds(ids.note) } })
      .select("noteIds")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          noteIds: mongoose.Types.ObjectId[];
        }>
      >()
      .exec(),
  ]);
  const coursesByNote = new Map<string, string[]>();
  for (const course of courses) {
    for (const noteId of course.noteIds) {
      const list = coursesByNote.get(String(noteId)) ?? [];
      list.push(String(course._id));
      coursesByNote.set(String(noteId), list);
    }
  }
  const result = new Map<KnowledgeSourceKey, NodeMetadata>();
  for (const note of notes) {
    result.set(`note:${String(note._id)}`, {
      title: note.title,
      groupIds: (note.groupIds ?? []).map(String),
      courseIds: coursesByNote.get(String(note._id)) ?? [],
    });
  }
  for (const voiceNote of voiceNotes) {
    result.set(`voice-note:${String(voiceNote._id)}`, {
      title: voiceNote.title,
      groupIds: [],
      courseIds: [],
    });
  }
  for (const document of documents) {
    result.set(`document:${String(document._id)}`, {
      title: document.title,
      groupIds: [],
      courseIds: document.courseId ? [String(document.courseId)] : [],
    });
  }
  return result;
}

async function totalInScope(notebookId?: string): Promise<number> {
  if (!notebookId) return countSources({ includeArchived: false });
  return (await resolveNotebookSourceKeys(notebookId)).length;
}

export async function getKnowledgeSpace(scope: {
  notebookId?: string;
}): Promise<KnowledgeSpaceResponse> {
  await connectDB();
  const model = KNOWLEDGE_VECTOR_CONFIG.model;
  const scopeKey = scopeOf(scope.notebookId);
  const [filter, total] = await Promise.all([
    scopeFilter(scope.notebookId),
    totalInScope(scope.notebookId),
  ]);
  const metas = await loadMetas(filter);
  const inputHash = spaceInputHash(metas, model);

  const exact = await KnowledgeProjection.findOne({
    scope: scopeKey,
    model,
    inputHash,
    status: "ready",
  })
    .lean()
    .exec();
  const projection =
    exact ??
    (await KnowledgeProjection.findOne({
      scope: scopeKey,
      model,
      status: "ready",
    })
      .sort({ computedAt: -1 })
      .lean()
      .exec());
  const stale = !exact && metas.length > 0;
  if (stale) {
    const queued = await queueKnowledgeProjectionJob(scopeKey).then(
      () => true,
      (error) => {
        console.error("[Knowledge] Could not queue projection", error);
        return false;
      },
    );
    if (queued) drainKnowledgeJobsSoon(1);
  }

  const chunkCounts = new Map(
    metas.map((meta) => [meta.sourceKey, meta.chunkCount]),
  );
  const positioned = (projection?.nodes ?? []).filter((node) =>
    chunkCounts.has(node.key),
  );
  const metadata = await loadNodeMetadata(positioned.map((node) => node.key));
  const nodes: KnowledgeSpaceNode[] = [];
  for (const node of positioned) {
    const parsed = parseKnowledgeSourceKey(node.key);
    const info = metadata.get(node.key);
    if (!parsed || !info) continue;
    nodes.push({
      key: node.key,
      kind: parsed.kind,
      id: parsed.id,
      title: info.title,
      x: node.x,
      y: node.y,
      groupIds: info.groupIds,
      courseIds: info.courseIds,
      chunkCount: chunkCounts.get(node.key) ?? 0,
    });
  }
  const present = new Set(nodes.map((node) => node.key));
  const neighbors: Record<string, KnowledgeSpaceNeighbor[]> = {};
  for (const node of nodes) {
    neighbors[node.key] = (projection?.neighbors[node.key] ?? [])
      .filter((neighbor) => present.has(neighbor.key))
      .map((neighbor) => ({
        key: neighbor.key,
        similarity: neighbor.similarity,
      }));
  }
  return {
    nodes,
    neighbors,
    model,
    computedAt: projection ? projection.computedAt.toISOString() : null,
    stale,
    coverage: { embedded: metas.length, total },
  };
}

/** The projection job: reads every vector in scope, so it never runs on a request. */
export async function processProjectionJob(
  scopeKey: string,
  force: boolean,
): Promise<{ scope: string; nodes: number; skipped: boolean }> {
  await connectDB();
  const model = KNOWLEDGE_VECTOR_CONFIG.model;
  const notebookId = scopeKey.startsWith("notebook:")
    ? scopeKey.slice("notebook:".length)
    : undefined;
  const filter = await scopeFilter(notebookId);
  const metas = await loadMetas(filter);
  const inputHash = spaceInputHash(metas, model);
  if (!force) {
    const existing = await KnowledgeProjection.exists({
      scope: scopeKey,
      model,
      inputHash,
      status: "ready",
    });
    if (existing)
      return { scope: scopeKey, nodes: metas.length, skipped: true };
  }

  const rows = await KnowledgeSourceVector.find({ model, ...filter })
    .select("sourceKey vector")
    .sort({ sourceKey: 1 })
    .lean<Array<{ sourceKey: string; vector: number[] }>>()
    .exec();
  const items: VectorItem[] = rows.map((row) => ({
    key: row.sourceKey,
    vector: row.vector,
  }));
  const positions = await layoutSourceVectors(items);
  const neighbors = computeNeighbors(items, MAX_NEIGHBORS_PER_NODE);
  const nodes = items.map((item, index) => ({
    key: item.key,
    x: positions[index]?.[0] ?? 0,
    y: positions[index]?.[1] ?? 0,
  }));
  await KnowledgeProjection.updateOne(
    { scope: scopeKey, model, inputHash },
    {
      $set: {
        nodes,
        neighbors,
        computedAt: new Date(),
        status: "ready",
      },
      $unset: { error: "" },
    },
    { upsert: true },
  );
  const stale = await KnowledgeProjection.find({ scope: scopeKey, model })
    .sort({ computedAt: -1 })
    .skip(2)
    .select("_id")
    .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
    .exec();
  if (stale.length > 0) {
    await KnowledgeProjection.deleteMany({
      _id: { $in: stale.map((row) => row._id) },
    });
  }
  return { scope: scopeKey, nodes: nodes.length, skipped: false };
}
