import { inflateRawSync } from "node:zlib";
import { documentLimits, type DocumentKind } from "./types";
import type { PageText } from "./chunk";

export class ExtractError extends Error {}

export type Extracted = {
  kind: DocumentKind;
  pages: PageText[];
  pageCount: number | null;
  warnings: string[];
};

const extensionKinds: Record<string, DocumentKind> = {
  pdf: "pdf",
  txt: "text",
  text: "text",
  md: "markdown",
  markdown: "markdown",
  csv: "csv",
  html: "html",
  htm: "html",
  docx: "docx",
};

const startsWith = (bytes: Uint8Array, signature: string) =>
  signature.split("").every((char, index) => bytes[index] === char.charCodeAt(0));

export function detectKind(name: string, bytes: Uint8Array): DocumentKind {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const byName = extensionKinds[extension];
  if (startsWith(bytes.subarray(0, 1024), "%PDF-")) return "pdf";
  if (byName === "pdf")
    throw new ExtractError("This file is named .pdf but is not a PDF.");
  if (startsWith(bytes, "PK")) {
    if (byName === "docx") return "docx";
    throw new ExtractError("Zip archives are not supported. Upload a PDF, DOCX, text, markdown, CSV or HTML file.");
  }
  if (byName === "docx")
    throw new ExtractError("This file is named .docx but is not a Word document.");
  if (!byName)
    throw new ExtractError("Unsupported file type. Upload a PDF, DOCX, text, markdown, CSV or HTML file.");
  return byName;
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  euro: "€",
  pound: "£",
  copy: "©",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return entities[body.toLowerCase()] ?? match;
  });
}

const ligatures = /[ﬀ-ﬆ]/g;

export function normalizeText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(ligatures, (char) => char.normalize("NFKC"))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

type TagAction = { emit: string; skipBody?: boolean };

const isNameChar = (code: number) =>
  (code >= 48 && code <= 58) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 || code === 95;

const isTagStart = (code: number) =>
  code === 47 || code === 33 || code === 63 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

/**
 * Single-pass tag stripper. Every index search moves forward only (and the
 * next ">" is cached), so unclosed or adversarial markup stays linear.
 */
function stripMarkup(source: string, onTag: (name: string, closing: boolean) => TagAction): string {
  const out: string[] = [];
  const length = source.length;
  let cursor = 0;
  let textStart = 0;
  let gtCache = -1;
  let noMoreGt = false;
  const nextGt = (from: number) => {
    if (noMoreGt) return -1;
    if (gtCache < from) {
      gtCache = source.indexOf(">", from);
      if (gtCache < 0) noMoreGt = true;
    }
    return gtCache;
  };
  while (cursor < length) {
    const lt = source.indexOf("<", cursor);
    if (lt < 0) break;
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      out.push(source.slice(textStart, lt), " ");
      cursor = textStart = end < 0 ? length : end + 3;
      continue;
    }
    if (!isTagStart(source.charCodeAt(lt + 1))) {
      cursor = lt + 1;
      continue;
    }
    const gt = nextGt(lt + 1);
    if (gt < 0) {
      cursor = lt + 1;
      continue;
    }
    const closing = source[lt + 1] === "/";
    let nameEnd = lt + (closing ? 2 : 1);
    const nameStart = nameEnd;
    while (nameEnd < gt && isNameChar(source.charCodeAt(nameEnd))) nameEnd++;
    const name = source.slice(nameStart, nameEnd).toLowerCase();
    out.push(source.slice(textStart, lt));
    const action = onTag(name, closing);
    out.push(action.emit);
    cursor = gt + 1;
    if (action.skipBody && !closing && source[gt - 1] !== "/") {
      let search = cursor;
      cursor = length;
      for (;;) {
        const close = source.indexOf("</", search);
        if (close < 0) break;
        const after = close + 2 + name.length;
        if (
          source.slice(close + 2, after).toLowerCase() === name &&
          !isNameChar(source.charCodeAt(after))
        ) {
          const end = source.indexOf(">", after);
          cursor = end < 0 ? length : end + 1;
          break;
        }
        search = close + 2;
      }
    }
    textStart = cursor;
  }
  out.push(source.slice(textStart));
  return out.join("");
}

const htmlSkipped = new Set(["script", "style", "noscript", "svg", "head"]);
const htmlBlocks = new Set([
  "p", "div", "section", "article", "header", "footer", "li", "tr", "table",
  "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
]);

export function htmlToText(html: string) {
  return decodeEntities(
    stripMarkup(html, (name, closing) => {
      if (!closing && htmlSkipped.has(name)) return { emit: " ", skipBody: true };
      if (!closing && (name === "br" || name === "hr")) return { emit: "\n" };
      if (closing && htmlBlocks.has(name)) return { emit: "\n\n" };
      if (closing && (name === "td" || name === "th")) return { emit: "\t" };
      return { emit: "" };
    }),
  );
}

const readU16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const readU32 = (view: DataView, offset: number) => view.getUint32(offset, true);

/** Reads one entry from a zip via its central directory, with a decompressed-size cap. */
export function readZipEntry(bytes: Uint8Array, wanted: string, maxBytes: number): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (readU32(view, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ExtractError("The Word document is corrupt (no zip directory).");
  const count = readU16(view, end + 10);
  let cursor = readU32(view, end + 16);
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > bytes.length || readU32(view, cursor) !== 0x02014b50) break;
    const method = readU16(view, cursor + 10);
    const compressed = readU32(view, cursor + 20);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const local = readU32(view, cursor + 42);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if (local + 30 > bytes.length || readU32(view, local) !== 0x04034b50)
      throw new ExtractError("The Word document is corrupt.");
    const start = local + 30 + readU16(view, local + 26) + readU16(view, local + 28);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) return data;
    if (method !== 8) throw new ExtractError("The Word document uses an unsupported compression.");
    try {
      return inflateRawSync(data, { maxOutputLength: maxBytes });
    } catch {
      throw new ExtractError("The Word document is corrupt or expands to an unreasonable size.");
    }
  }
  return null;
}

export function docxToText(bytes: Uint8Array) {
  const xml = readZipEntry(bytes, "word/document.xml", 40 * 1024 * 1024);
  if (!xml) throw new ExtractError("No document body found in this Word file.");
  const text = stripMarkup(new TextDecoder().decode(xml), (name, closing) => {
    if (!closing && name === "w:tab") return { emit: "\t" };
    if (!closing && (name === "w:br" || name === "w:cr")) return { emit: "\n" };
    if (closing && name === "w:p") return { emit: "\n\n" };
    if (closing && name === "w:tc") return { emit: "\t" };
    return { emit: "" };
  });
  return decodeEntities(text);
}

function dehyphenate(text: string) {
  return text.replace(/([a-z])-\n([a-z])/g, "$1$2");
}

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException")
      throw new ExtractError("This PDF is password protected. Remove the password and upload it again.");
    throw new ExtractError("This PDF could not be read. It may be corrupt.");
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((raw, index) => ({
      page: index + 1,
      text: normalizeText(dehyphenate(raw)),
    }));
    const chars = pages.reduce((sum, page) => sum + page.text.length, 0);
    if (chars < Math.max(40, totalPages * 20))
      throw new ExtractError(
        `This PDF has no readable text layer (${totalPages} page${totalPages === 1 ? "" : "s"}, ${chars} characters). It looks scanned; OCR is not supported. Upload a text-based PDF.`,
      );
    const empty = pages.filter((page) => page.text.length < 20).length;
    const warnings =
      empty > 0 && empty < totalPages
        ? [`${empty} of ${totalPages} pages have no extractable text (images or scans).`]
        : [];
    return { kind: "pdf", pages, pageCount: totalPages, warnings };
  } finally {
    await pdf.cleanup();
  }
}

export async function extractDocument(
  name: string,
  bytes: Uint8Array,
): Promise<Extracted> {
  if (!bytes.length) throw new ExtractError("The file is empty.");
  if (bytes.length > documentLimits.uploadBytes)
    throw new ExtractError("The file is larger than 25 MB.");
  const kind = detectKind(name, bytes);
  let result: Extracted;
  if (kind === "pdf") result = await extractPdf(bytes);
  else {
    const raw =
      kind === "docx"
        ? docxToText(bytes)
        : kind === "html"
          ? htmlToText(decodeText(bytes))
          : decodeText(bytes);
    const text = normalizeText(raw);
    if (!text) throw new ExtractError("No text found in this file.");
    result = { kind, pages: [{ page: null, text }], pageCount: null, warnings: [] };
  }
  const total = result.pages.reduce((sum, page) => sum + page.text.length, 0);
  if (total > documentLimits.textChars) {
    let budget = documentLimits.textChars;
    const kept: PageText[] = [];
    for (const page of result.pages) {
      if (budget <= 0) break;
      kept.push(budget >= page.text.length ? page : { ...page, text: page.text.slice(0, budget) });
      budget -= page.text.length;
    }
    result = {
      ...result,
      pages: kept,
      warnings: [
        ...result.warnings,
        `Text was truncated to the first ${documentLimits.textChars.toLocaleString("en-US")} characters of ${total.toLocaleString("en-US")}.`,
      ],
    };
  }
  return result;
}
