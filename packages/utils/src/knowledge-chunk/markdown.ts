import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  type Atom,
  type Block,
  type ListItem,
  type Section,
  SectionBuilder,
  type TableRow,
} from "./types";

const processor = remark().use(remarkGfm).use(remarkMath);

type Root = ReturnType<typeof processor.parse>;
type Node = Root["children"][number];

const ATOMIC_TYPES = new Set([
  "inlineCode",
  "inlineMath",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "footnoteReference",
  "code",
  "math",
]);

function startOf(node: Node): number | undefined {
  return node.position?.start.offset;
}

function endOf(node: Node): number | undefined {
  return node.position?.end.offset;
}

function collectAtoms(node: Node, base: number, atoms: Atom[] = []): Atom[] {
  const start = startOf(node);
  const end = endOf(node);
  if (ATOMIC_TYPES.has(node.type) && start !== undefined && end !== undefined) {
    atoms.push({ start: start - base, end: end - base });
    return atoms;
  }
  if ("children" in node) {
    for (const child of node.children) collectAtoms(child, base, atoms);
  }
  return atoms;
}

function plainText(node: Node): string {
  if (node.type === "break") return " ";
  if (node.type === "image") return node.alt ?? "";
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return node.children.map(plainText).join("");
  return "";
}

function fenceFor(source: string, code: string): string {
  const char = source.trimStart().startsWith("~~~") ? "~" : "`";
  const opening = /^\s*([`~]{3,})/.exec(source)?.[1]?.length ?? 3;
  let longest = 0;
  for (const run of code.matchAll(char === "~" ? /~+/g : /`+/g)) {
    longest = Math.max(longest, run[0].length);
  }
  return char.repeat(Math.max(3, opening, longest + 1));
}

function toBlock(node: Node, markdown: string): Block | null {
  const start = startOf(node);
  const end = endOf(node);
  if (start === undefined || end === undefined) return null;
  const text = markdown.slice(start, end);
  if (text.trim().length === 0) return null;

  switch (node.type) {
    case "thematicBreak":
      return null;
    case "list": {
      const items = node.children.flatMap((item): ListItem[] => {
        const itemStart = startOf(item);
        const itemEnd = endOf(item);
        if (itemStart === undefined || itemEnd === undefined) return [];
        return [
          {
            text: markdown.slice(itemStart, itemEnd),
            start: itemStart,
            atoms: collectAtoms(item, itemStart),
          },
        ];
      });
      return { kind: "list", text, start, end, items };
    }
    case "table": {
      const [header, ...body] = node.children;
      const headerEnd = header ? endOf(header) : undefined;
      if (!header || headerEnd === undefined)
        return { kind: "atom", text, start, end };
      const firstBody = body[0];
      const delimiter = markdown
        .slice(headerEnd, firstBody ? startOf(firstBody) : end)
        .trim();
      const rows = body.flatMap((row): TableRow[] => {
        const rowStart = startOf(row);
        const rowEnd = endOf(row);
        if (rowStart === undefined || rowEnd === undefined) return [];
        return [{ text: markdown.slice(rowStart, rowEnd), start: rowStart }];
      });
      const headText = markdown.slice(startOf(header), headerEnd);
      return {
        kind: "table",
        text,
        start,
        end,
        head: `${headText}\n${delimiter}`,
        rows,
      };
    }
    case "code":
      return {
        kind: "code",
        text,
        start,
        end,
        lang: node.lang ?? "",
        fence: fenceFor(text, node.value),
        code: node.value,
      };
    case "math":
    case "html":
      return { kind: "atom", text, start, end };
    default:
      return {
        kind: "text",
        text,
        start,
        end,
        atoms: collectAtoms(node, start),
      };
  }
}

export function markdownToSections(markdown: string): Section {
  const tree = processor.parse(markdown);
  const builder = new SectionBuilder();
  for (const node of tree.children) {
    if (node.type === "heading") {
      const title = plainText(node).replace(/\s+/g, " ").trim();
      if (title) {
        builder.open({
          title,
          level: node.depth,
          start: startOf(node),
          end: endOf(node),
        });
      }
      continue;
    }
    const block = toBlock(node, markdown);
    if (block) builder.add(block);
  }
  return builder.root;
}
