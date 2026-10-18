import type {
  MacrosRecipeBlock,
  MacrosRecipeInline,
} from "@repo/schemas/macros";
import type { JSONContent } from "@tiptap/react";

export const IMAGE_NODE = "recipeImage";

function inlinesFrom(nodes: readonly JSONContent[] = []): MacrosRecipeInline[] {
  const out: MacrosRecipeInline[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      out.push({ text: "\n" });
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const run: MacrosRecipeInline = { text: node.text };
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") run.bold = true;
      if (mark.type === "italic") run.italic = true;
      if (mark.type === "link" && typeof mark.attrs?.href === "string")
        run.href = mark.attrs.href;
    }
    out.push(run);
  }
  return out;
}

/** Several paragraphs inside one quote or list item become one run list. */
function joinParagraphs(nodes: readonly JSONContent[] = []) {
  const out: MacrosRecipeInline[] = [];
  for (const node of nodes) {
    if (node.type !== "paragraph") continue;
    if (out.length) out.push({ text: "\n" });
    out.push(...inlinesFrom(node.content));
  }
  return out;
}

/** Nested lists flatten into the outer list: the stored model has one level. */
function listItems(list: JSONContent): MacrosRecipeInline[][] {
  return (list.content ?? []).flatMap((item) => [
    joinParagraphs(item.content),
    ...(item.content ?? [])
      .filter(
        (child) => child.type === "bulletList" || child.type === "orderedList",
      )
      .flatMap(listItems),
  ]);
}

export function docToBlocks(doc: JSONContent): MacrosRecipeBlock[] {
  const blocks: MacrosRecipeBlock[] = [];
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case "paragraph":
        blocks.push({ type: "paragraph", content: inlinesFrom(node.content) });
        break;
      case "heading":
        blocks.push({
          type: "heading",
          text: inlinesFrom(node.content)
            .map((run) => run.text)
            .join(""),
        });
        break;
      case "blockquote":
        blocks.push({ type: "quote", content: joinParagraphs(node.content) });
        break;
      case "bulletList":
      case "orderedList":
        blocks.push({
          type: "list",
          ordered: node.type === "orderedList",
          items: listItems(node),
        });
        break;
      case IMAGE_NODE: {
        const imageKey = node.attrs?.imageKey;
        if (typeof imageKey !== "string" || !imageKey) break;
        const caption = node.attrs?.caption;
        const imageUrl = node.attrs?.src;
        blocks.push({
          type: "image",
          imageKey,
          ...(typeof caption === "string" && caption ? { caption } : {}),
          ...(typeof imageUrl === "string" ? { imageUrl } : {}),
        });
        break;
      }
    }
  }
  return blocks;
}

function textNodes(content: readonly MacrosRecipeInline[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const run of content) {
    const marks = [
      ...(run.bold ? [{ type: "bold" }] : []),
      ...(run.italic ? [{ type: "italic" }] : []),
      ...(run.href ? [{ type: "link", attrs: { href: run.href } }] : []),
    ];
    run.text.split("\n").forEach((line, index) => {
      if (index > 0) out.push({ type: "hardBreak" });
      if (line)
        out.push({
          type: "text",
          text: line,
          ...(marks.length ? { marks } : {}),
        });
    });
  }
  return out;
}

function paragraph(content: readonly MacrosRecipeInline[]): JSONContent {
  const nodes = textNodes(content);
  return { type: "paragraph", ...(nodes.length ? { content: nodes } : {}) };
}

export function blocksToDoc(blocks: readonly MacrosRecipeBlock[]): JSONContent {
  const content = blocks.map((block): JSONContent => {
    switch (block.type) {
      case "paragraph":
        return paragraph(block.content);
      case "heading":
        return {
          type: "heading",
          attrs: { level: 2 },
          ...(block.text
            ? { content: [{ type: "text", text: block.text }] }
            : {}),
        };
      case "quote":
        return { type: "blockquote", content: [paragraph(block.content)] };
      case "list":
        return {
          type: block.ordered ? "orderedList" : "bulletList",
          content: block.items.map((item) => ({
            type: "listItem",
            content: [paragraph(item)],
          })),
        };
      case "image":
        return {
          type: IMAGE_NODE,
          attrs: {
            imageKey: block.imageKey,
            src: block.imageUrl ?? null,
            caption: block.caption ?? "",
          },
        };
    }
  });
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}
