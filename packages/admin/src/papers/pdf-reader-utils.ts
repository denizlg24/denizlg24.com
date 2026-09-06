export interface PdfSearchResult {
  page: number;
  index: number;
  excerpt: string;
}

export interface PdfOutlineEntry {
  title: string;
  depth: number;
  destination: string | unknown[] | null;
}

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

export function flattenPdfOutline(
  nodes: OutlineNode[],
  depth = 0,
): PdfOutlineEntry[] {
  return nodes.flatMap((node) => [
    { title: node.title, depth, destination: node.dest },
    ...flattenPdfOutline(node.items, depth + 1),
  ]);
}

export function findPdfMatches(
  text: string,
  query: string,
  page: number,
): PdfSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const matches: PdfSearchResult[] = [];
  let offset = 0;
  while (matches.length < 100) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    const start = Math.max(0, index - 48);
    const end = Math.min(text.length, index + needle.length + 72);
    matches.push({
      page,
      index,
      excerpt: `${start ? "…" : ""}${text.slice(start, end).trim()}${
        end < text.length ? "…" : ""
      }`,
    });
    offset = index + Math.max(needle.length, 1);
  }
  return matches;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function highlightPdfText(text: string, query: string): string {
  const needle = query.trim();
  if (!needle) return escapeHtml(text);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "giu"));
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? `<mark class="bg-amber-300/70 text-black">${escapeHtml(part)}</mark>`
        : escapeHtml(part),
    )
    .join("");
}
