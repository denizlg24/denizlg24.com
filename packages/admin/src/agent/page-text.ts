const SKIPPED = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TEXTAREA",
  "SVG",
]);
const BLOCKS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "SECTION",
  "SUMMARY",
  "UL",
]);

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

function tex(element: Element): string | null {
  return (
    element
      .querySelector('annotation[encoding="application/x-tex"]')
      ?.textContent?.trim() || null
  );
}

function markdownTable(table: HTMLTableElement): string {
  const rows = Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells).map((cell) =>
        collapse(cell.textContent ?? "").replace(/\|/g, "/"),
      ),
    )
    .filter((cells) => cells.some(Boolean));
  const [header, ...body] = rows;
  if (!header) return "";
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...body.map(line)].join(
    "\n",
  );
}

/**
 * The page as `innerText` would read it, except that what a speech model
 * cannot pronounce comes back as source the narrator can detect: code blocks
 * fenced, tables as markdown, and KaTeX as its TeX (rendered KaTeX reads
 * every formula twice, once per hidden MathML copy and once as glyphs).
 */
export function speakablePageText(root: Element): string {
  const out: string[] = [];
  const block = (text: string) => out.push(`\n\n${text}\n\n`);

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element) || SKIPPED.has(node.tagName.toUpperCase()))
      return;
    if (!node.checkVisibility({ visibilityProperty: true })) return;
    if (node.classList.contains("katex-display")) {
      const source = tex(node);
      if (source) return block(`$$\n${source}\n$$`);
    }
    if (node.classList.contains("katex")) {
      const source = tex(node);
      if (source) return void out.push(` $${source}$ `);
    }
    if (node instanceof HTMLPreElement) {
      return block(
        `\`\`\`\n${(node.textContent ?? "").replace(/\n+$/, "")}\n\`\`\``,
      );
    }
    if (node instanceof HTMLTableElement) return block(markdownTable(node));
    if (node instanceof HTMLBRElement) return void out.push("\n");
    const isBlock = BLOCKS.has(node.tagName);
    if (isBlock) out.push("\n\n");
    for (const child of node.childNodes) walk(child);
    if (isBlock) out.push("\n\n");
  };

  walk(root);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
