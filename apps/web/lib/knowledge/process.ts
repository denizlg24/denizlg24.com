import type { KnowledgeSourceKey } from "@repo/schemas";
import { parseKnowledgeSourceKey } from "@repo/schemas";
import {
  CHUNKER_VERSION,
  type ChunkDraft,
  chunkContentHash,
} from "@repo/utils/knowledge-chunk";
import mongoose, { type AnyBulkWriteOperation } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { type IKnowledgeChunk, KnowledgeChunk } from "@/models/KnowledgeChunk";
import { KnowledgeSourceState } from "@/models/KnowledgeSourceState";
import { KnowledgeSourceVector } from "@/models/KnowledgeSourceVector";
import { type ChunkPlan, planChunkDiff } from "./diff";
import { embedChunkTexts } from "./embed";
import { normalizedMean } from "./math";
import { loadKnowledgeSource } from "./sources";
import { KNOWLEDGE_VECTOR_CONFIG } from "./vector-config";

export interface ProcessSourceResult {
  sourceKey: KnowledgeSourceKey;
  state: "embedded" | "empty" | "failed" | "missing";
  chunks: number;
  embedded: number;
  reused: number;
  deleted: number;
}

function draftFields(
  draft: ChunkDraft,
  hashes: { contentHash: string; bodyHash: string },
  ordinal: number,
  title: string,
): { set: Record<string, unknown>; unset: Record<string, ""> } {
  const set: Record<string, unknown> = {
    ordinal,
    title,
    headingPath: draft.headingPath,
    body: draft.body,
    text: draft.text,
    tokenCount: draft.tokenCount,
    contentHash: hashes.contentHash,
    bodyHash: hashes.bodyHash,
    chunkerVersion: CHUNKER_VERSION,
    model: KNOWLEDGE_VECTOR_CONFIG.model,
    status: "active",
  };
  const unset: Record<string, ""> = {};
  const optional = {
    page: draft.page,
    startMs: draft.startMs,
    endMs: draft.endMs,
    sourceStart: draft.sourceStart,
    sourceEnd: draft.sourceEnd,
  };
  for (const [field, value] of Object.entries(optional)) {
    if (value === undefined) unset[field] = "";
    else set[field] = value;
  }
  return { set, unset };
}

async function clearSource(sourceKey: string): Promise<number> {
  const [{ deletedCount }] = await Promise.all([
    KnowledgeChunk.deleteMany({ sourceKey }),
    KnowledgeSourceVector.deleteMany({ sourceKey }),
  ]);
  return deletedCount;
}

async function setState(
  sourceKey: string,
  state: "embedded" | "empty" | "failed",
  fields: { chunkCount?: number; error?: string },
) {
  await KnowledgeSourceState.updateOne(
    { sourceKey },
    {
      $set: {
        state,
        chunkCount: fields.chunkCount ?? 0,
        ...(state === "failed"
          ? { error: (fields.error ?? "").slice(0, 2_000) }
          : { chunkerVersion: CHUNKER_VERSION, indexedAt: new Date() }),
      },
      ...(state === "failed" ? {} : { $unset: { error: "" } }),
    },
    { upsert: true },
  );
}

/**
 * `(sourceKey, ordinal)` is unique, and chunks swap or shift ordinals: rows
 * that move or are about to be deleted step aside to ordinals below every
 * stored one first, so the final writes never meet a transient duplicate.
 */
async function vacateOrdinals(
  existing: ReadonlyArray<{ _id: mongoose.Types.ObjectId; ordinal: number }>,
  plan: ChunkPlan,
): Promise<void> {
  const finalOrdinal = new Map(
    plan.entries.flatMap((entry) =>
      entry.existingId ? [[entry.existingId, entry.ordinal] as const] : [],
    ),
  );
  const leaving = existing.filter(
    (chunk) => finalOrdinal.get(String(chunk._id)) !== chunk.ordinal,
  );
  if (leaving.length === 0) return;
  const floor = Math.min(0, ...existing.map((chunk) => chunk.ordinal)) - 1;
  await KnowledgeChunk.bulkWrite(
    leaving.map((chunk, index) => ({
      updateOne: {
        filter: { _id: chunk._id },
        update: { $set: { ordinal: floor - index } },
      },
    })),
    { ordered: false },
  );
}

async function reconcileChunks(
  sourceKey: string,
  sourceId: mongoose.Types.ObjectId,
  kind: "note" | "document" | "voice-note",
  title: string,
  drafts: ChunkDraft[],
): Promise<{ embedded: number; reused: number; deleted: number }> {
  const model = KNOWLEDGE_VECTOR_CONFIG.model;
  const [hashes, bodyHashes] = await Promise.all([
    Promise.all(drafts.map((draft) => chunkContentHash(draft.text))),
    Promise.all(drafts.map((draft) => chunkContentHash(draft.body))),
  ]);
  const existing = await KnowledgeChunk.find({ sourceKey })
    .select("ordinal contentHash bodyHash model chunkerVersion")
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        ordinal: number;
        contentHash: string;
        bodyHash?: string;
        model: string;
        chunkerVersion: number;
      }>
    >()
    .exec();
  const existingRefs = existing.map((chunk) => ({
    id: String(chunk._id),
    ordinal: chunk.ordinal,
    contentHash: chunk.contentHash,
    ...(chunk.bodyHash ? { bodyHash: chunk.bodyHash } : {}),
    model: chunk.model,
    chunkerVersion: chunk.chunkerVersion,
  }));
  const draftRefs = drafts.map((draft, index) => ({
    ordinal: draft.ordinal,
    contentHash: hashes[index] ?? "",
    bodyHash: bodyHashes[index] ?? "",
  }));

  const needsVector = planChunkDiff({
    existing: existingRefs,
    drafts: draftRefs,
    model,
    reusableHashes: new Set(),
  })
    .entries.filter((entry) => entry.action !== "keep")
    .map((entry) => entry.contentHash);
  const reusable = new Map<string, number[]>();
  if (needsVector.length > 0) {
    const donors = await KnowledgeChunk.find({
      contentHash: { $in: [...new Set(needsVector)] },
      model,
    })
      .select("contentHash vector")
      .lean<Array<{ contentHash: string; vector: number[] }>>()
      .exec();
    for (const donor of donors) {
      if (donor.vector.length === KNOWLEDGE_VECTOR_CONFIG.dimensions) {
        reusable.set(donor.contentHash, donor.vector);
      }
    }
  }

  const plan = planChunkDiff({
    existing: existingRefs,
    drafts: draftRefs,
    model,
    reusableHashes: new Set(reusable.keys()),
  });

  const toEmbed = plan.entries.filter((entry) => entry.action === "embed");
  const draftByOrdinal = new Map(drafts.map((d) => [d.ordinal, d]));
  const embeddedVectors = await embedChunkTexts(
    toEmbed.map((entry) => draftByOrdinal.get(entry.ordinal)?.text ?? ""),
  );
  const embeddedByOrdinal = new Map(
    toEmbed.map((entry, index) => [entry.ordinal, embeddedVectors[index]]),
  );

  const now = new Date();
  const operations: AnyBulkWriteOperation<IKnowledgeChunk>[] = [];
  for (const entry of plan.entries) {
    const draft = draftByOrdinal.get(entry.ordinal);
    if (!draft) continue;
    const { set, unset } = draftFields(
      draft,
      { contentHash: entry.contentHash, bodyHash: entry.bodyHash },
      entry.ordinal,
      title,
    );
    const vector =
      entry.action === "embed"
        ? embeddedByOrdinal.get(entry.ordinal)
        : entry.action === "reuse"
          ? reusable.get(entry.contentHash)
          : undefined;
    if (vector) {
      set.vector = vector;
      set.embeddedAt = now;
    }
    if (entry.existingId) {
      operations.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(entry.existingId) },
          update: {
            $set: set,
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
          },
        },
      });
      continue;
    }
    if (!vector) {
      throw new Error(`No vector for chunk ${sourceKey}#${entry.ordinal}`);
    }
    operations.push({
      insertOne: {
        document: {
          sourceKind: kind,
          sourceId,
          sourceKey,
          ordinal: entry.ordinal,
          title,
          headingPath: draft.headingPath,
          body: draft.body,
          text: draft.text,
          tokenCount: draft.tokenCount,
          contentHash: entry.contentHash,
          bodyHash: entry.bodyHash,
          chunkerVersion: CHUNKER_VERSION,
          model: KNOWLEDGE_VECTOR_CONFIG.model,
          vector,
          embeddedAt: now,
          status: "active",
          createdAt: now,
          updatedAt: now,
          ...(draft.page ? { page: draft.page } : {}),
          ...(draft.startMs !== undefined ? { startMs: draft.startMs } : {}),
          ...(draft.endMs !== undefined ? { endMs: draft.endMs } : {}),
          ...(draft.sourceStart !== undefined
            ? { sourceStart: draft.sourceStart }
            : {}),
          ...(draft.sourceEnd !== undefined
            ? { sourceEnd: draft.sourceEnd }
            : {}),
        },
      },
    });
  }
  await vacateOrdinals(existing, plan);
  if (operations.length > 0) {
    await KnowledgeChunk.bulkWrite(operations, { ordered: false });
  }
  let deleted = 0;
  if (plan.deleteIds.length > 0) {
    const result = await KnowledgeChunk.deleteMany({
      _id: { $in: plan.deleteIds.map((id) => new mongoose.Types.ObjectId(id)) },
    });
    deleted = result.deletedCount;
  }
  return {
    embedded: toEmbed.length,
    reused: plan.entries.filter((entry) => entry.action === "reuse").length,
    deleted,
  };
}

async function refreshSourceVector(
  sourceKey: string,
  sourceId: mongoose.Types.ObjectId,
  kind: "note" | "document" | "voice-note",
): Promise<number> {
  const rows = await KnowledgeChunk.find({
    sourceKey,
    model: KNOWLEDGE_VECTOR_CONFIG.model,
  })
    .select("vector")
    .lean<Array<{ vector: number[] }>>()
    .exec();
  const vector = normalizedMean(rows.map((row) => row.vector));
  if (!vector) {
    await KnowledgeSourceVector.deleteMany({ sourceKey });
    return 0;
  }
  await KnowledgeSourceVector.updateOne(
    { sourceKey, model: KNOWLEDGE_VECTOR_CONFIG.model },
    { $set: { kind, id: sourceId, vector, chunkCount: rows.length } },
    { upsert: true },
  );
  return rows.length;
}

/** Brings one source's chunks, vectors and state in line with its current text. */
export async function processKnowledgeSource(
  sourceKey: KnowledgeSourceKey,
): Promise<ProcessSourceResult> {
  const parsed = parseKnowledgeSourceKey(sourceKey);
  if (!parsed) throw new Error(`Invalid knowledge source key: ${sourceKey}`);
  await connectDB();
  const sourceId = new mongoose.Types.ObjectId(parsed.id);
  const result: ProcessSourceResult = {
    sourceKey,
    state: "embedded",
    chunks: 0,
    embedded: 0,
    reused: 0,
    deleted: 0,
  };
  try {
    const loaded = await loadKnowledgeSource(parsed.kind, parsed.id);
    if (loaded.status === "missing") {
      result.deleted = await clearSource(sourceKey);
      await KnowledgeSourceState.deleteOne({ sourceKey });
      return { ...result, state: "missing" };
    }
    if (loaded.status === "failed") {
      await setState(sourceKey, "failed", { error: loaded.error });
      return { ...result, state: "failed" };
    }
    if (loaded.drafts.length === 0) {
      result.deleted = await clearSource(sourceKey);
      await setState(sourceKey, "empty", {});
      return { ...result, state: "empty" };
    }
    const reconciled = await reconcileChunks(
      sourceKey,
      sourceId,
      parsed.kind,
      loaded.title,
      loaded.drafts,
    );
    const chunks = await refreshSourceVector(sourceKey, sourceId, parsed.kind);
    await setState(sourceKey, "embedded", { chunkCount: chunks });
    return { ...result, ...reconciled, chunks };
  } catch (error) {
    await setState(sourceKey, "failed", {
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}
