import type {
  KnowledgeHit,
  KnowledgeChunk as WireChunk,
  StudyDocument as WireDocument,
} from "@repo/schemas";
import type { ILeanKnowledgeChunk } from "@/models/KnowledgeChunk";
import type { ILeanStudyDocument } from "@/models/StudyDocument";
import { bodyHashOf } from "./body-hash";

export function serializeChunk(chunk: ILeanKnowledgeChunk): WireChunk {
  return {
    _id: String(chunk._id),
    sourceKind: chunk.sourceKind,
    sourceId: String(chunk.sourceId),
    sourceKey: chunk.sourceKey,
    ordinal: chunk.ordinal,
    title: chunk.title,
    headingPath: chunk.headingPath,
    ...(chunk.page
      ? { page: { start: chunk.page.start, end: chunk.page.end } }
      : {}),
    ...(chunk.startMs !== undefined ? { startMs: chunk.startMs } : {}),
    ...(chunk.endMs !== undefined ? { endMs: chunk.endMs } : {}),
    body: chunk.body,
    ...(chunk.sourceStart !== undefined
      ? { sourceStart: chunk.sourceStart }
      : {}),
    ...(chunk.sourceEnd !== undefined ? { sourceEnd: chunk.sourceEnd } : {}),
    tokenCount: chunk.tokenCount,
    contentHash: chunk.contentHash,
    chunkerVersion: chunk.chunkerVersion,
    model: chunk.model,
    updatedAt: chunk.updatedAt.toISOString(),
  };
}

export function chunkToHit(
  chunk: ILeanKnowledgeChunk,
  ranking: { score: number; vectorRank?: number; lexicalRank?: number },
): KnowledgeHit {
  return {
    chunkId: String(chunk._id),
    sourceKey: chunk.sourceKey,
    sourceKind: chunk.sourceKind,
    sourceId: String(chunk.sourceId),
    title: chunk.title,
    headingPath: chunk.headingPath,
    ...(chunk.page
      ? { page: { start: chunk.page.start, end: chunk.page.end } }
      : {}),
    ...(chunk.startMs !== undefined ? { startMs: chunk.startMs } : {}),
    ...(chunk.endMs !== undefined ? { endMs: chunk.endMs } : {}),
    ...(chunk.sourceStart !== undefined
      ? { sourceStart: chunk.sourceStart }
      : {}),
    ...(chunk.sourceEnd !== undefined ? { sourceEnd: chunk.sourceEnd } : {}),
    body: chunk.body,
    contentHash: bodyHashOf(chunk),
    score: ranking.score,
    ...(ranking.vectorRank !== undefined
      ? { vectorRank: ranking.vectorRank }
      : {}),
    ...(ranking.lexicalRank !== undefined
      ? { lexicalRank: ranking.lexicalRank }
      : {}),
  };
}

export function serializeStudyDocument(doc: ILeanStudyDocument): WireDocument {
  return {
    _id: String(doc._id),
    title: doc.title,
    fileName: doc.fileName,
    fileUrl: doc.fileUrl,
    size: doc.size,
    ...(doc.pageCount !== undefined ? { pageCount: doc.pageCount } : {}),
    ...(doc.layout ? { layout: doc.layout } : {}),
    extraction: doc.extraction,
    ...(doc.extractionError ? { extractionError: doc.extractionError } : {}),
    ...(doc.courseId ? { courseId: String(doc.courseId) } : {}),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
