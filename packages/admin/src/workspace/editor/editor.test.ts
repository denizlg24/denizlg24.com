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
    // 300 real editor mounts: ~1 s locally, past bun's 5 s default on CI runners.
  }, 30_000);

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

  /** A real keydown through ProseMirror; `keyboardShortcut` replays steps and remaps them twice. */
  function press(editor: EditorType, key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true });
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));
  }

  function caretIn(editor: EditorType, id: string, at: "start" | "end") {
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.id !== id) return true;
      editor.commands.setTextSelection(
        at === "start" ? pos + 1 : pos + node.nodeSize - 1,
      );
      return false;
    });
  }

  test("Enter on an empty last line of a toggle leaves the toggle", () => {
    const editor = editorFor([
      {
        id: "t",
        type: "toggle",
        text: runs("Toggle"),
        children: [{ id: "in", type: "paragraph", text: runs("inside") }],
      },
    ]);
    caretIn(editor, "in", "end");
    press(editor, "Enter");
    press(editor, "Enter");
    editor.commands.insertContent("out");
    const after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after.map((b) => b.type)).toEqual(["toggle", "paragraph"]);
    expect(after[1]?.type === "paragraph" && after[1].text).toEqual(
      runs("out"),
    );
    const toggle = after[0];
    expect(toggle?.type === "toggle" && toggle.children.length).toBe(1);
  });

  test("Backspace at the start of a callout turns it into text, children kept", () => {
    const editor = editorFor([
      { id: "p", type: "paragraph", text: runs("before") },
      {
        id: "c",
        type: "callout",
        text: runs("note"),
        emoji: "💡",
        color: "default",
        children: [{ id: "k", type: "paragraph", text: runs("kid") }],
      },
    ]);
    let start = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.id === "c") start = pos + 2;
    });
    editor.commands.setTextSelection(start);
    press(editor, "Backspace");
    const after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after).toEqual([
      { id: "p", type: "paragraph", text: runs("before") },
      { id: "c", type: "paragraph", text: runs("note") },
      { id: "k", type: "paragraph", text: runs("kid") },
    ]);
  });

  test("Backspace in an emptied column removes it; the last one dissolves", () => {
    const editor = editorFor([
      {
        id: "row",
        type: "columns",
        children: [
          {
            id: "c1",
            type: "column",
            width: 0.5,
            children: [{ id: "l", type: "paragraph", text: runs("left") }],
          },
          {
            id: "c2",
            type: "column",
            width: 0.5,
            children: [{ id: "r", type: "paragraph", text: [] }],
          },
        ],
      },
    ]);
    caretIn(editor, "r", "start");
    press(editor, "Backspace");
    const after = doc.docToBlocks(editor.getJSON());
    const caret = commands.caretOf(editor);
    editor.destroy();
    expect(after).toEqual([{ id: "l", type: "paragraph", text: runs("left") }]);
    expect(caret).toEqual({ id: "l", offset: 4 });
  });

  test("a selected widget goes with Backspace, and so does one reached from the line after it", () => {
    const editor = editorFor([
      { id: "w", type: "stats" },
      { id: "p", type: "paragraph", text: [] },
    ]);
    caretIn(editor, "p", "start");
    press(editor, "Backspace");
    press(editor, "Backspace");
    const after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after.some((b) => b.id === "w")).toBe(false);
  });

  test("the add button types a slash on a new line after the block, or before it", () => {
    const editor = editorFor([
      { id: "a", type: "paragraph", text: runs("alpha") },
      { id: "b", type: "paragraph", text: runs("beta") },
    ]);
    commands.startBlockMenu(editor, "a", "after");
    let after = doc.docToBlocks(editor.getJSON());
    expect(after.map((b) => (b.type === "paragraph" ? b.text : null))).toEqual([
      runs("alpha"),
      runs("/"),
      runs("beta"),
    ]);
    commands.startBlockMenu(editor, "a", "before");
    after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after[0]?.type === "paragraph" && after[0].text).toEqual(runs("/"));
    expect(after).toHaveLength(4);
  });

  test("the add button on an empty line reuses it", () => {
    const editor = editorFor([{ id: "e", type: "paragraph", text: [] }]);
    commands.startBlockMenu(editor, "e", "after");
    const after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after).toEqual([{ id: "e", type: "paragraph", text: runs("/") }]);
  });

  test("an unfocused editor that opens on a widget holds no block selection", () => {
    const editor = editorFor([
      { id: "w", type: "stats" },
      { id: "p", type: "paragraph", text: runs("text") },
    ]);
    expect(editor.state.selection.constructor.name).toBe("NodeSelection");
    commands.settleUnfocused(editor);
    const name = editor.state.selection.constructor.name;
    editor.destroy();
    expect(name).not.toBe("NodeSelection");
  });

  test("clicking below the last block adds an empty line only when there is none", () => {
    const editor = editorFor([{ id: "w", type: "stats" }]);
    commands.focusTrailingLine(editor);
    commands.focusTrailingLine(editor);
    const after = doc.docToBlocks(editor.getJSON());
    editor.destroy();
    expect(after.map((b) => b.type)).toEqual(["stats", "paragraph"]);
  });
});
