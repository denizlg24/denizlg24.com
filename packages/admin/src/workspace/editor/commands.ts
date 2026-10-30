import type { Block } from "@repo/schemas";
import {
  editSiblings,
  findBlock,
  replaceBlock,
} from "@repo/utils/workspace-tree";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { blocksToDoc, docToBlocks, type TurnIntoTarget, turnInto } from "./doc";

/** Meta on a transaction that brings in what the store holds; the editor does not diff it back. */
export const REMOTE_META = "workspaceRemote";

/** Nodes whose first paragraph is their own text, not a child block. */
const TEXT_SLOT_PARENTS = new Set([
  "listItem",
  "taskItem",
  "toggle",
  "callout",
  "blockquote",
]);

function hasId(node: PMNode): boolean {
  return typeof node.attrs.id === "string" && node.attrs.id.length > 0;
}

/** The innermost block around `pos`: a text slot answers for its container. */
export function blockAt(
  doc: PMNode,
  pos: number,
): { node: PMNode; pos: number } | null {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (!hasId(node)) continue;
    const parent = $pos.node(depth - 1);
    if (
      node.type.name === "paragraph" &&
      TEXT_SLOT_PARENTS.has(parent.type.name) &&
      $pos.index(depth - 1) === 0
    ) {
      continue;
    }
    if (node.type.name === "column") continue;
    return { node, pos: $pos.before(depth) };
  }
  return null;
}

export function blockAtSelection(
  editor: Editor,
): { node: PMNode; pos: number } | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && hasId(selection.node)) {
    return { node: selection.node, pos: selection.from };
  }
  return blockAt(editor.state.doc, selection.from);
}

function findNode(
  doc: PMNode,
  id: string,
): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.id === id) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/** Where a block's own text starts, for putting the caret back in it. */
function textStart(node: PMNode, pos: number): number | null {
  if (node.isTextblock) return pos + 1;
  if (TEXT_SLOT_PARENTS.has(node.type.name)) return pos + 2;
  return null;
}

export interface Caret {
  id: string;
  offset: number;
}

/** The caret as a block id and an offset into its text, which survive the document being rebuilt. */
export function caretOf(editor: Editor): Caret | null {
  const block = blockAtSelection(editor);
  if (!block) return null;
  const start = textStart(block.node, block.pos);
  const offset =
    start === null ? 0 : Math.max(0, editor.state.selection.from - start);
  const id = block.node.attrs.id;
  return typeof id === "string" ? { id, offset } : null;
}

/**
 * Replaces only the top-level nodes that differ, so node views elsewhere
 * keep their state, then puts the caret back by block id.
 */
export function replaceDocument(
  editor: Editor,
  json: JSONContent,
  options: { remote: boolean; caret?: Caret | null },
): void {
  const next = editor.schema.nodeFromJSON(json);
  const { state } = editor;
  const prev = state.doc;
  const caret = options.caret === undefined ? caretOf(editor) : options.caret;
  let start = 0;
  const shared = Math.min(prev.childCount, next.childCount);
  while (start < shared && prev.child(start).eq(next.child(start))) start++;
  let endPrev = prev.childCount;
  let endNext = next.childCount;
  while (
    endPrev > start &&
    endNext > start &&
    prev.child(endPrev - 1).eq(next.child(endNext - 1))
  ) {
    endPrev--;
    endNext--;
  }
  if (start === endPrev && start === endNext) return;
  const offsetOf = (doc: PMNode, index: number) => {
    let offset = 0;
    for (let i = 0; i < index; i++) offset += doc.child(i).nodeSize;
    return offset;
  };
  const from = offsetOf(prev, start);
  const to = offsetOf(prev, endPrev);
  const slice = next.content.cut(
    offsetOf(next, start),
    offsetOf(next, endNext),
  );
  const tr = state.tr.replaceWith(from, to, slice);
  if (options.remote) {
    tr.setMeta(REMOTE_META, true);
    tr.setMeta("addToHistory", false);
  }
  if (caret) {
    const target = findNode(tr.doc, caret.id);
    if (target) {
      const begin = textStart(target.node, target.pos);
      if (begin === null) {
        tr.setSelection(NodeSelection.create(tr.doc, target.pos));
      } else {
        const textblock = tr.doc.resolve(begin).parent;
        const at = begin + Math.min(caret.offset, textblock.content.size);
        tr.setSelection(TextSelection.create(tr.doc, at));
      }
    }
  }
  editor.view.dispatch(tr);
}

/** Rewrites the document through the block model, as one undoable step. */
export function transformBlocks(
  editor: Editor,
  transform: (blocks: Block[]) => Block[],
  caret?: Caret | null,
): void {
  const blocks = docToBlocks(editor.getJSON());
  replaceDocument(editor, blocksToDoc(transform(blocks)), {
    remote: false,
    caret,
  });
}

export function turnBlockInto(
  editor: Editor,
  id: string,
  target: TurnIntoTarget,
): void {
  const caret = caretOf(editor);
  transformBlocks(
    editor,
    (blocks) => {
      const location = findBlock(blocks, id);
      if (!location) return blocks;
      const [first, ...rest] = turnInto(location.block, target);
      if (!first) return blocks;
      const swapped = replaceBlock(blocks, id, first) ?? blocks;
      if (rest.length === 0) return swapped;
      return insertAfter(swapped, id, rest);
    },
    caret?.id === id ? caret : { id, offset: 0 },
  );
}

/** `blocks` placed right after block `id`, among its siblings. */
export function insertAfter(
  tree: Block[],
  id: string,
  blocks: Block[],
): Block[] {
  const location = findBlock(tree, id);
  if (!location) return [...tree, ...blocks];
  return (
    editSiblings(tree, location.parentId, (siblings) => {
      const list = [...siblings];
      list.splice(location.index + 1, 0, ...blocks);
      return list;
    }) ?? tree
  );
}
