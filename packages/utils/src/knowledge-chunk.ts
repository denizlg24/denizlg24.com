import type { PageRange } from "@repo/schemas";
import { chunkTree } from "./knowledge-chunk/assemble";
import { markdownToSections } from "./knowledge-chunk/markdown";
import { pdfStructure } from "./knowledge-chunk/pdf";
import { chunkTranscriptText } from "./knowledge-chunk/transcript";
import type { ChunkContext } from "./knowledge-chunk/types";

/**
 * Bump when chunk boundaries or the context header change. The reindex job
 * re-chunks every source whose chunks carry an older version; embeddings of
 * text that did not change are reused by hash.
 */
export const CHUNKER_VERSION = 1;

export interface ChunkBudget {
  target: number;
  max: number;
  min: number;
  /** Fraction of a cut paragraph/list repeated at the start of the next piece. */
  overlap: number;
}

export const DEFAULT_CHUNK_BUDGET: ChunkBudget = {
  target: 350,
  max: 512,
  min: 80,
  overlap: 0.12,
};

export type TokenCounter = (text: string) => number;

export interface ChunkOptions {
  budget?: Partial<ChunkBudget>;
  countTokens?: TokenCounter;
}

export interface ChunkDraft {
  ordinal: number;
  headingPath: string[];
  /** What the UI quotes. */
  body: string;
  /** Context header + body: what is embedded. */
  text: string;
  tokenCount: number;
  /** Character offsets of `body`'s content in the source string (notes, transcripts). */
  sourceStart?: number;
  sourceEnd?: number;
  page?: PageRange;
  startMs?: number;
  endMs?: number;
}

export interface MarkdownSource {
  title: string;
  markdown: string;
}

/** A positioned run of text from pdfjs `getTextContent`, already in page order. */
export interface PdfTextItem {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  bold: boolean;
  hasEOL: boolean;
}

export interface PdfOutlineEntry {
  title: string;
  page: number;
  depth: number;
}

export interface PdfSource {
  title: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  items: PdfTextItem[];
  outline?: PdfOutlineEntry[];
}

export interface PdfChunkResult {
  chunks: ChunkDraft[];
  layout: "document" | "slides";
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptSource {
  title: string;
  recordedAt?: string;
  segments: TranscriptSegment[];
}

/** Deliberately pessimistic: roughly one token per 3.2 characters. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(Math.ceil(text.length / 3.2), words);
}

function contextFor(
  title: string,
  options: ChunkOptions | undefined,
  paged: boolean,
): ChunkContext {
  const merged = { ...DEFAULT_CHUNK_BUDGET, ...options?.budget };
  const max = Math.max(1, merged.max);
  const target = Math.min(merged.target, max);
  return {
    title,
    budget: { ...merged, max, target, min: Math.min(merged.min, target) },
    count: options?.countTokens ?? estimateTokens,
    paged,
  };
}

export function chunkMarkdown(
  source: MarkdownSource,
  options?: ChunkOptions,
): ChunkDraft[] {
  return chunkTree(
    markdownToSections(source.markdown),
    contextFor(source.title, options, false),
  );
}

export function chunkPdf(
  source: PdfSource,
  options?: ChunkOptions,
): PdfChunkResult {
  const { root, layout } = pdfStructure(source);
  return {
    chunks: chunkTree(root, contextFor(source.title, options, true)),
    layout,
  };
}

export function chunkTranscript(
  source: TranscriptSource,
  options?: ChunkOptions,
): ChunkDraft[] {
  return chunkTranscriptText(source, contextFor(source.title, options, false));
}

/** Stable hash of a chunk's embedded text (sha-256 hex). */
export async function chunkContentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
