import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Block } from "@repo/schemas";
import { genBlocks, rng } from "@repo/utils/workspace-gen.test-util";
import { deepEqual, diffBlockTrees } from "@repo/utils/workspace-ops";
import type { Editor as EditorType } from "@tiptap/core";

/*
 * The editor's schema and the block mapping, through a real ProseMirror
 * editor in happy-dom: what loads is what reads back, typing is one update,
 * and the menus' commands build the trees they claim to. Node views are
 * React and are not rendered here.
 */

let Editor: typeof EditorType;
let doc: typeof import("./doc");
let extensions: typeof import("./extensions");
let commands: typeof import("./commands");

beforeAll(async () => {
  GlobalRegistrator.register();
  Editor = (await import("@tiptap/core")).Editor;
  doc = await import("./doc");
  extensions = await import("./extensions");
  commands = await import("./commands");
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function editorFor(blocks: Block[]): EditorType {
  return new Editor({
    element: document.createElement("div"),
    extensions: extensions.flowExtensions({
      views: null,
      mentions: async () => [],
      placeholder: "",
    }),
    content: doc.blocksToDoc(blocks),
  });
}

const runs = (text: string) => [{ type: "text" as const, text }];

describe("flow editor", () => {
  test("any block tree loads and reads back as its canonical form, ids kept (property)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const blocks = genBlocks(rng(seed), 6);
      const editor = editorFor(blocks);
      const read = doc.docToBlocks(editor.getJSON());
      const canonical = doc.canonicalBlocks(blocks);
      editor.destroy();
      if (!deepEqual(read, canonical)) {
        throw new Error(
          `seed ${seed}\n${JSON.stringify(canonical)}\n${JSON.stringify(read)}`,
        );
      }
      // Canonical is stable: a second pass changes nothing.
      expect(deepEqual(doc.canonicalBlocks(canonical), canonical)).toBe(true);
    }
  });

  test("typing in a nested paragraph diffs to one update of that block", () => {
    const blocks: Block[] = [
      {
        id: "t",
        type: "toggle",
        text: runs("Toggle"),
        children: [{ id: "p", type: "paragraph", text: runs("hel") }],
      },
    ];
    const editor = editorFor(blocks);
    const before = doc.docToBlocks(editor.getJSON());
    let end = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.id === "p") end = pos + node.nodeSize - 1;
    });
    editor.commands.insertContentAt(end, "lo");
    const ops = diffBlockTrees(before, doc.docToBlocks(editor.getJSON()));
    editor.destroy();
    expect(ops).toEqual([
      { op: "update", id: "p", set: { text: runs("hello") }, replace: true },
    ]);
  });

  test("turn into keeps the id and promotes children a leaf cannot hold", () => {
    const editor = editorFor([
      {
        id: "b",
        type: "bullet",
        text: runs("item"),
        children: [{ id: "c", type: "paragraph", text: runs("child") }],
      },
    ]);
    const target = doc.TURN_INTO.find((t) => t.key === "h2");
    if (!target) throw new Error("no h2");
    commands.turnBlockInto(editor, "b", target);
    const after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after).toEqual([
      { id: "b", type: "heading", level: 2, text: runs("item") },
      { id: "c", type: "paragraph", text: runs("child") },
    ]);
  });

  test("the slash menu's insert replaces an empty paragraph with the block", () => {
    const editor = editorFor([
      { id: "p", type: "paragraph", text: runs("text") },
      { id: "e", type: "paragraph", text: [] },
    ]);
    let inEmpty = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.id === "e") inEmpty = pos + 1;
    });
    editor.commands.setTextSelection(inEmpty);
    extensions.insertBlock(editor, "columns");
    const after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after.map((b) => b.type)).toEqual(["paragraph", "columns"]);
    const row = after[1];
    expect(row?.type === "columns" && row.children.length).toBe(2);
  });

  test("markdown shortcuts build lists, quotes and to-dos", () => {
    const editor = editorFor([]);
    const type = (text: string) => {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (f) =>
        f(editor.view, from, to, text, () =>
          editor.state.tr.insertText(text, from, to),
        ),
      );
      if (!handled)
        editor.view.dispatch(editor.state.tr.insertText(text, from, to));
    };
    for (const ch of "- ") type(ch);
    expect(editor.getJSON().content?.[0]?.type).toBe("bulletList");
    editor.commands.setContent(doc.blocksToDoc([]));
    editor.commands.focus("end");
    for (const ch of "> ") type(ch);
    expect(editor.getJSON().content?.[0]?.type).toBe("blockquote");
    editor.commands.setContent(doc.blocksToDoc([]));
    editor.commands.focus("end");
    for (const ch of "[ ] ") type(ch);
    expect(editor.getJSON().content?.[0]?.type).toBe("taskList");
    editor.destroy();
  });

  test("a remote change replaces only what differs and keeps the caret in its block", () => {
    const editor = editorFor([
      { id: "a", type: "paragraph", text: runs("alpha") },
      { id: "b", type: "paragraph", text: runs("beta") },
    ]);
    let inB = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.id === "b") inB = pos + 3;
    });
    editor.commands.setTextSelection(inB);
    commands.replaceDocument(
      editor,
      doc.blocksToDoc([
        { id: "a", type: "paragraph", text: runs("ALPHA, longer now") },
        { id: "b", type: "paragraph", text: runs("beta") },
      ]),
      { remote: true },
    );
    const caret = commands.caretOf(editor);
    const read = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(caret).toEqual({ id: "b", offset: 2 });
    expect(read[0]).toEqual({
      id: "a",
      type: "paragraph",
      text: runs("ALPHA, longer now"),
    });
  });
});
