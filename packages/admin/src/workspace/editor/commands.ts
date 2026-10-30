import type { Block } from "@repo/schemas";
import {
  editSiblings,
  findBlock,
  replaceBlock,
} from "@repo/utils/workspace-tree";
import type { Editor, JSONContent } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { newId } from "../seed";
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

/** `blocks` placed right before block `id`, among its siblings. */
export function insertBefore(
  tree: Block[],
  id: string,
  blocks: Block[],
): Block[] {
  const location = findBlock(tree, id);
  if (!location) return [...blocks, ...tree];
  return (
    editSiblings(tree, location.parentId, (siblings) => {
      const list = [...siblings];
      list.splice(location.index, 0, ...blocks);
      return list;
    }) ?? tree
  );
}

/**
 * Starts a new line beside block `id` (or reuses it when it is an empty
 * paragraph) and types "/" into it, which opens the block menu there.
 */
export function startBlockMenu(
  editor: Editor,
  id: string,
  place: "before" | "after",
): void {
  editor.view.focus();
  const target = findNode(editor.state.doc, id);
  if (
    target?.node.type.name === "paragraph" &&
    target.node.content.size === 0 &&
    !isTextSlot(editor.state.doc, target.pos)
  ) {
    const at = target.pos + 1;
    const tr = editor.state.tr.insertText("/", at);
    editor.view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView(),
    );
    return;
  }
  const line: Block = { id: newId(), type: "paragraph", text: [] };
  transformBlocks(
    editor,
    (blocks) =>
      place === "before"
        ? insertBefore(blocks, id, [line])
        : insertAfter(blocks, id, [line]),
    { id: line.id, offset: 0 },
  );
  editor.view.dispatch(editor.state.tr.insertText("/").scrollIntoView());
}

/** Puts the caret on an empty last line, adding one when the page ends in anything else. */
export function focusTrailingLine(editor: Editor): void {
  const { doc } = editor.state;
  const last = doc.lastChild;
  if (last?.type.name === "paragraph" && last.content.size === 0) {
    editor.commands.focus("end");
    return;
  }
  const line: Block = { id: newId(), type: "paragraph", text: [] };
  transformBlocks(editor, (blocks) => [...blocks, line], {
    id: line.id,
    offset: 0,
  });
  editor.view.focus();
}

function isTextSlot(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  return TEXT_SLOT_PARENTS.has($pos.parent.type.name) && $pos.index() === 0;
}

/** Containers whose later children are typed into like ordinary lines. */
const LINE_CONTAINERS = new Set(["toggle", "callout", "blockquote"]);

/** Enter on an empty last line inside a toggle, callout or quote moves the line out after it. */
export function exitContainer(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  const line = $from.parent;
  if ($from.depth < 2 || line.type.name !== "paragraph") return false;
  if (line.content.size > 0) return false;
  const container = $from.node(-1);
  if (!LINE_CONTAINERS.has(container.type.name)) return false;
  const index = $from.index(-1);
  if (index === 0 || index !== container.childCount - 1) return false;
  const linePos = $from.before();
  const after = $from.after(-1);
  const tr = editor.state.tr.delete(linePos, linePos + line.nodeSize);
  const at = tr.mapping.map(after);
  tr.insert(at, line.type.create(line.attrs));
  tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}

/** Backspace at the very start of a toggle, callout or quote turns it back into text. */
export function unwrapAtStart(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.parentOffset !== 0 || $from.depth < 2) return false;
  if ($from.parent.type.name !== "paragraph" || $from.index(-1) !== 0)
    return false;
  const container = $from.node(-1);
  if (!LINE_CONTAINERS.has(container.type.name)) return false;
  const id = container.attrs.id;
  if (typeof id !== "string") return false;
  turnBlockInto(editor, id, {
    key: "paragraph",
    label: "Text",
    type: "paragraph",
  });
  return true;
}

/**
 * Backspace in a column holding only an empty line removes the column; the
 * last column left dissolves into its blocks.
 */
export function removeEmptyColumn(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth < 3 || $from.parent.content.size > 0) return false;
  const column = $from.node(-1);
  const columns = $from.node(-2);
  if (column.type.name !== "column" || columns.type.name !== "columns")
    return false;
  if (column.childCount !== 1) return false;
  const columnId = column.attrs.id;
  const columnsId = columns.attrs.id;
  if (typeof columnId !== "string" || typeof columnsId !== "string")
    return false;
  const after: { caret: Caret | null } = { caret: null };
  transformBlocks(
    editor,
    (blocks) => {
      const location = findBlock(blocks, columnsId);
      if (location?.block.type !== "columns") return blocks;
      const index = location.block.children.findIndex((c) => c.id === columnId);
      const rest = location.block.children.filter((c) => c.id !== columnId);
      const neighbour = rest[Math.max(0, index - 1)];
      const landing =
        index > 0 ? neighbour?.children.at(-1) : neighbour?.children[0];
      if (landing)
        after.caret = {
          id: landing.id,
          offset: index > 0 ? Number.MAX_SAFE_INTEGER : 0,
        };
      const replacement: Block[] =
        rest.length === 1
          ? (rest[0]?.children ?? [])
          : [{ ...location.block, children: rest }];
      return (
        editSiblings(blocks, location.parentId, (siblings) => {
          const list = [...siblings];
          list.splice(location.index, 1, ...replacement);
          return list;
        }) ?? blocks
      );
    },
    null,
  );
  if (after.caret) placeCaret(editor, after.caret);
  return true;
}

function placeCaret(editor: Editor, caret: Caret): void {
  const target = findNode(editor.state.doc, caret.id);
  if (!target) return;
  const begin = textStart(target.node, target.pos);
  const { tr } = editor.state;
  if (begin === null) {
    tr.setSelection(NodeSelection.create(tr.doc, target.pos));
  } else {
    const size = tr.doc.resolve(begin).parent.content.size;
    tr.setSelection(
      TextSelection.create(tr.doc, begin + Math.min(caret.offset, size)),
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
}

/**
 * An editor without focus holds no block selection. ProseMirror starts a
 * document that opens with a widget with that widget selected, and a remote
 * merge maps the selection wherever it lands; either way the page would open
 * with a block tinted and its controls out. The selection moves to the first
 * text position (or a gap cursor), which shows nothing until focus arrives.
 */
export function settleUnfocused(editor: Editor): void {
  const { view } = editor;
  if (view.hasFocus()) return;
  const { selection, doc } = view.state;
  if (!(selection instanceof NodeSelection)) return;
  const start = doc.resolve(0);
  const next = Selection.findFrom(start, 1, true) ?? new GapCursor(start);
  view.dispatch(
    view.state.tr
      .setSelection(next)
      .setMeta(REMOTE_META, true)
      .setMeta("addToHistory", false),
  );
}
