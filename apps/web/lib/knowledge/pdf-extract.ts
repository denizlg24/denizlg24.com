import type {
  PdfOutlineEntry,
  PdfSource,
  PdfTextItem,
} from "@repo/utils/knowledge-chunk";
import { getDocumentProxy } from "unpdf";

export const MAX_PDF_PAGES = 1_500;
const MAX_OUTLINE_ENTRIES = 500;
const MIN_TEXT_CHARS = 20;
const BOLD_FONT = /bold|black|heavy|semibold|demi/i;

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type OutlineNode = Awaited<ReturnType<PdfDocument["getOutline"]>>[number];

interface PageRef {
  num: number;
  gen: number;
}

function isPageRef(value: unknown): value is PageRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "num" in value &&
    "gen" in value &&
    typeof value.num === "number" &&
    typeof value.gen === "number"
  );
}

async function destinationPage(
  pdf: PdfDocument,
  dest: OutlineNode["dest"],
): Promise<number | null> {
  const resolved =
    typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  const target = resolved?.[0];
  if (typeof target === "number") return target + 1;
  if (isPageRef(target)) return (await pdf.getPageIndex(target)) + 1;
  return null;
}

async function readOutline(pdf: PdfDocument): Promise<PdfOutlineEntry[]> {
  const entries: PdfOutlineEntry[] = [];
  const walk = async (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      if (entries.length >= MAX_OUTLINE_ENTRIES) return;
      const title = node.title.replace(/\s+/g, " ").trim();
      const page = await destinationPage(pdf, node.dest).catch(() => null);
      if (title && page !== null) entries.push({ title, page, depth });
      await walk(node.items, depth + 1);
    }
  };
  const outline = await pdf.getOutline().catch(() => null);
  if (outline) await walk(outline, 0);
  return entries;
}

export interface PdfExtraction {
  source: PdfSource;
  /** No text layer to chunk; OCR is out of scope. */
  empty: boolean;
}

export async function extractPdfSource(
  bytes: Uint8Array,
  title: string,
): Promise<PdfExtraction> {
  const pdf = await getDocumentProxy(bytes, { fontExtraProperties: true });
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}`,
      );
    }
    const items: PdfTextItem[] = [];
    let pageWidth = 0;
    let pageHeight = 0;
    let characters = 0;
    const boldFonts = new Map<string, boolean>();
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      if (pageNumber === 1) {
        const [x0, y0, x1, y1] = page.view;
        pageWidth = Math.abs((x1 ?? 0) - (x0 ?? 0));
        pageHeight = Math.abs((y1 ?? 0) - (y0 ?? 0));
      }
      const content = await page.getTextContent();
      const fontNames = new Set<string>();
      for (const item of content.items) {
        if ("str" in item) fontNames.add(item.fontName);
      }
      // Real font names only reach the main thread once the page's operator
      // list has run; font ids repeat across pages, so most pages skip this.
      if ([...fontNames].some((name) => !boldFonts.has(name))) {
        await page.getOperatorList();
        for (const name of fontNames) {
          if (boldFonts.has(name) || !page.commonObjs.has(name)) continue;
          const font = page.commonObjs.get(name);
          boldFonts.set(
            name,
            BOLD_FONT.test(String(font?.name ?? "")) || Boolean(font?.bold),
          );
        }
      }
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (item.str.length === 0 && !item.hasEOL) continue;
        const bold = boldFonts.get(item.fontName) ?? false;
        const [, , c = 0, d = 0, x = 0, y = 0] = item.transform;
        characters += item.str.trim().length;
        items.push({
          page: pageNumber,
          str: item.str,
          x,
          y,
          width: item.width,
          height: item.height,
          fontSize: Math.hypot(c, d) || item.height,
          fontName: item.fontName,
          bold,
          hasEOL: item.hasEOL,
        });
      }
      page.cleanup();
    }
    const outline = await readOutline(pdf);
    const source: PdfSource = {
      title,
      pageCount: pdf.numPages,
      pageWidth,
      pageHeight,
      items,
      ...(outline.length > 0 ? { outline } : {}),
    };
    return { source, empty: characters < MIN_TEXT_CHARS };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
