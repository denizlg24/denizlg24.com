import type { IChatMessageAttachment } from "@repo/schemas";

/**
 * Cohere rejects oversized payloads and a single huge attachment should never
 * be able to flood the corpus, so both the bytes we fetch and the number of
 * chunks one document can produce are bounded.
 */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_PDF_CHUNKS = 60;
const TARGET_CHUNK_CHARS = 1_800;
const CHUNK_OVERLAP_CHARS = 200;
const MIN_CHUNK_CHARS = 80;

export interface AttachmentPart {
  /** Stable within one attachment; used to key evidence idempotently. */
  index: number;
  /** Text for a PDF chunk, absent for an image. */
  text?: string;
  /** Base64 data URI for an image, absent for a PDF chunk. */
  image?: string;
  /** 1-based page the chunk came from, when known. */
  page?: number;
}

export interface LoadedAttachment {
  attachment: IChatMessageAttachment;
  parts: AttachmentPart[];
}

export class AttachmentLoadError extends Error {}

async function fetchAttachmentBytes(url: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AttachmentLoadError(
      `Attachment fetch failed: ${response.status} ${url}`,
    );
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentLoadError(
      `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
    );
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentLoadError(
      `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
    );
  }
  return {
    bytes: new Uint8Array(buffer),
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
  };
}

/**
 * Splits page text on paragraph boundaries where it can and falls back to hard
 * slicing, keeping a small overlap so a sentence spanning a boundary is still
 * retrievable from one chunk.
 */
export function chunkDocumentText(
  text: string,
  page?: number,
  startIndex = 0,
): AttachmentPart[] {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length < MIN_CHUNK_CHARS) return [];

  const parts: AttachmentPart[] = [];
  let cursor = 0;
  let index = startIndex;
  while (cursor < normalized.length) {
    let end = Math.min(cursor + TARGET_CHUNK_CHARS, normalized.length);
    if (end < normalized.length) {
      const paragraph = normalized.lastIndexOf("\n\n", end);
      const sentence = normalized.lastIndexOf(". ", end);
      // A paragraph break splits on a real topic boundary, so take it whenever
      // it does not cost too much of the chunk; otherwise fall back to the
      // nearest sentence end rather than slicing mid-word.
      const paragraphFloor = cursor + TARGET_CHUNK_CHARS * 0.5;
      const boundary =
        paragraph > paragraphFloor ? paragraph : Math.max(paragraph, sentence);
      if (boundary > cursor + MIN_CHUNK_CHARS) {
        end = boundary + (boundary === paragraph ? 2 : 1);
      }
    }
    const slice = normalized.slice(cursor, end).trim();
    if (slice.length >= MIN_CHUNK_CHARS) {
      parts.push({ index, text: slice, page });
      index += 1;
    }
    if (end >= normalized.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP_CHARS, cursor + 1);
  }
  return parts;
}

async function extractPdfParts(bytes: Uint8Array): Promise<AttachmentPart[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  const parts: AttachmentPart[] = [];
  for (const [pageIndex, pageText] of pages.entries()) {
    if (parts.length >= MAX_PDF_CHUNKS) break;
    const remaining = MAX_PDF_CHUNKS - parts.length;
    const pageParts = chunkDocumentText(
      pageText ?? "",
      pageIndex + 1,
      parts.length,
    ).slice(0, remaining);
    parts.push(...pageParts);
  }
  return parts;
}

/**
 * Turns one attachment into the units that get embedded: a single image part,
 * or one part per PDF text chunk. A PDF with no extractable text (a pure scan)
 * yields nothing rather than an empty memory.
 */
export async function loadAttachmentParts(
  attachment: IChatMessageAttachment,
): Promise<LoadedAttachment> {
  const { bytes, contentType } = await fetchAttachmentBytes(attachment.url);

  if (attachment.type === "image") {
    const mime = contentType.startsWith("image/") ? contentType : "image/png";
    const base64 = Buffer.from(bytes).toString("base64");
    return {
      attachment,
      parts: [{ index: 0, image: `data:${mime};base64,${base64}` }],
    };
  }

  return { attachment, parts: await extractPdfParts(bytes) };
}
