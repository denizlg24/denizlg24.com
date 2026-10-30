import { BLOCK_TYPES, type BlockType, type MentionKind } from "@repo/schemas";
import { findBlock, replaceBlock } from "@repo/utils/workspace-tree";
import type { NodeViewRenderer } from "@tiptap/core";
import {
  type AnyExtension,
  type Editor,
  Extension,
  mergeAttributes,
  Node,
  wrappingInputRule,
} from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Placeholder } from "@tiptap/extensions";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Suggestion } from "@tiptap/suggestion";
import { LayoutTemplate } from "lucide-react";
import { BLOCK_CATALOG, BLOCK_CATEGORIES } from "../block-catalog";
import { createBlock, newId } from "../seed";
import {
  blockAtSelection,
  insertAfter,
  transformBlocks,
  turnBlockInto,
} from "./commands";
import { TURN_INTO, type TurnIntoTarget } from "./doc";
import { handleMenuKey, type MenuItem, menuOpen, useEditorMenu } from "./menu";

/** Node types that are blocks and carry an id. */
export const BLOCK_NODE_TYPES = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "toggle",
  "callout",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "columns",
  "column",
  "atomBlock",
];

function jsonAttr(name: string, fallback: unknown) {
  return {
    default: fallback,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute(`data-${name}`);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    renderHTML: (attributes: Record<string, unknown>) => ({
      [`data-${name}`]: JSON.stringify(attributes[name]),
    }),
  };
}

export interface FlowViews {
  toggle: NodeViewRenderer;
  callout: NodeViewRenderer;
  atomBlock: NodeViewRenderer;
  mention: NodeViewRenderer;
}

const Toggle = Node.create<{ views: FlowViews | null }>({
  name: "toggle",
  group: "block",
  content: "paragraph block*",
  defining: true,
  addOptions: () => ({ views: null }),
  addAttributes: () => ({ level: jsonAttr("level", null) }),
  parseHTML: () => [{ tag: 'div[data-type="toggle"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "toggle" }),
    0,
  ],
  addNodeView() {
    return this.options.views?.toggle ?? null;
  },
});

const Callout = Node.create<{ views: FlowViews | null }>({
  name: "callout",
  group: "block",
  content: "paragraph block*",
  defining: true,
  addOptions: () => ({ views: null }),
  addAttributes: () => ({
    emoji: jsonAttr("emoji", "💡"),
    color: jsonAttr("color", "default"),
  }),
  parseHTML: () => [{ tag: 'div[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "callout" }),
    0,
  ],
  addNodeView() {
    return this.options.views?.callout ?? null;
  },
});

/** Our quote: its first paragraph is its own text, the rest children. */
const Quote = Node.create({
  name: "blockquote",
  group: "block",
  content: "paragraph block*",
  defining: true,
  parseHTML: () => [{ tag: "blockquote" }],
  renderHTML: ({ HTMLAttributes }) => ["blockquote", HTMLAttributes, 0],
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*>\s$/, type: this.type })];
  },
});

const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="columns"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-type": "columns",
      class: "flow-columns",
    }),
    0,
  ],
});

const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  addAttributes: () => ({ width: jsonAttr("width", 0.5) }),
  parseHTML: () => [{ tag: 'div[data-type="column"]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-type": "column",
      class: "flow-column",
      style: `flex: ${Number(node.attrs.width) || 0.5} 1 0%`,
    }),
    0,
  ],
});

/** Any block with nothing to type into: widgets, media, tables, synced blocks… */
const AtomBlock = Node.create<{ views: FlowViews | null }>({
  name: "atomBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions: () => ({ views: null }),
  addAttributes: () => ({
    blockType: jsonAttr("block-type", "divider"),
    data: jsonAttr("data", {}),
  }),
  parseHTML: () => [{ tag: 'div[data-type="atom-block"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "atom-block" }),
  ],
  addNodeView() {
    return this.options.views?.atomBlock ?? null;
  },
});

const Mention = Node.create<{ views: FlowViews | null }>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ views: null }),
  addAttributes: () => ({
    kind: jsonAttr("kind", "page"),
    id: jsonAttr("mention-id", ""),
    label: jsonAttr("label", null),
  }),
  parseHTML: () => [{ tag: 'span[data-type="mention"]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-type": "mention" }),
    `@${node.attrs.label ?? node.attrs.id}`,
  ],
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  addNodeView() {
    return this.options.views?.mention ?? null;
  },
});

// --- the "/" menu ---------------------------------------------------------------

const CATEGORY_RANK = new Map<string, number>(
  BLOCK_CATEGORIES.map((category, index) => [category, index]),
);

function categoryRank(group: string | undefined): number {
  return CATEGORY_RANK.get(group ?? "") ?? BLOCK_CATEGORIES.length;
}

interface SlashChoice {
  item: MenuItem;
  keywords: string;
  run: (editor: Editor) => void;
}

function turnChoice(target: TurnIntoTarget): SlashChoice {
  const meta = BLOCK_CATALOG[target.type];
  return {
    item: {
      key: `turn:${target.key}`,
      label: target.label,
      icon: meta.icon,
      group: meta.category,
    },
    keywords: `${target.label} ${meta.keywords?.join(" ") ?? ""}`.toLowerCase(),
    run: (editor) => {
      const block = blockAtSelection(editor);
      const id = block?.node.attrs.id;
      if (typeof id === "string") turnBlockInto(editor, id, target);
    },
  };
}

/** A new block of `type` in place of the empty paragraph the caret is in, or right after the block. */
export function insertBlock(editor: Editor, type: BlockType): void {
  const block = createBlock(type);
  const current = blockAtSelection(editor);
  const currentId = current?.node.attrs.id;
  const empty =
    current?.node.type.name === "paragraph" && current.node.content.size === 0;
  transformBlocks(
    editor,
    (blocks) => {
      if (typeof currentId !== "string") return [...blocks, block];
      if (empty && findBlock(blocks, currentId)) {
        return replaceBlock(blocks, currentId, block) ?? blocks;
      }
      if (empty) return [...blocks, block];
      return insertAfter(blocks, currentId, [block]);
    },
    { id: block.id, offset: 0 },
  );
}

const SLASH_CHOICES: SlashChoice[] = [
  ...TURN_INTO.map(turnChoice),
  ...BLOCK_TYPES.filter(
    (type) =>
      !BLOCK_CATALOG[type].hidden && !TURN_INTO.some((t) => t.type === type),
  ).map((type) => {
    const meta = BLOCK_CATALOG[type];
    return {
      item: {
        key: `insert:${type}`,
        label: meta.label,
        icon: meta.icon,
        group: meta.category,
      },
      keywords: `${meta.label} ${meta.keywords?.join(" ") ?? ""}`.toLowerCase(),
      run: (editor: Editor) => insertBlock(editor, type),
    };
  }),
].sort((a, b) => categoryRank(a.item.group) - categoryRank(b.item.group));

function rectOf(clientRect: (() => DOMRect | null) | null | undefined) {
  const rect = clientRect?.();
  return rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
}

/** Suggestion callbacks that drive the shared menu. */
function menuRender<T>(toItems: (items: T[]) => MenuItem[]) {
  return () => ({
    onStart: (props: {
      items: T[];
      clientRect?: (() => DOMRect | null) | null;
      command: (item: MenuItem) => void;
    }) => {
      useEditorMenu
        .getState()
        .open(toItems(props.items), rectOf(props.clientRect), props.command);
    },
    onUpdate: (props: {
      items: T[];
      clientRect?: (() => DOMRect | null) | null;
    }) => {
      useEditorMenu
        .getState()
        .update(toItems(props.items), rectOf(props.clientRect));
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => handleMenuKey(event),
    onExit: () => useEditorMenu.getState().close(),
  });
}

/** Opens the template picker to insert at the caret; absent where templates cannot be inserted. */
export type TemplateInsertHandler = (editor: Editor) => void;

function templateChoice(onTemplate: TemplateInsertHandler): SlashChoice {
  return {
    item: {
      key: "template",
      label: "Template",
      icon: LayoutTemplate,
      group: "Layout",
    },
    keywords: "template insert snippet",
    run: onTemplate,
  };
}

const SlashMenu = Extension.create<{
  onTemplate: TemplateInsertHandler | null;
}>({
  name: "slashMenu",
  addOptions: () => ({ onTemplate: null }),
  addProseMirrorPlugins() {
    const choices = this.options.onTemplate
      ? [...SLASH_CHOICES, templateChoice(this.options.onTemplate)].sort(
          (a, b) => categoryRank(a.item.group) - categoryRank(b.item.group),
        )
      : SLASH_CHOICES;
    return [
      Suggestion<SlashChoice, MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashMenu"),
        char: "/",
        allowSpaces: false,
        allow: ({ state, range }) =>
          !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => {
          const q = query.toLowerCase();
          return choices.filter((choice) => !q || choice.keywords.includes(q));
        },
        command: ({ editor, range, props }) => {
          const choice = choices.find((c) => c.item.key === props.key);
          editor.chain().focus().deleteRange(range).run();
          choice?.run(editor);
        },
        render: menuRender((choices: SlashChoice[]) =>
          choices.map((c) => c.item),
        ),
      }),
    ];
  },
});

// --- "@" mentions ---------------------------------------------------------------

export interface MentionChoice {
  kind: MentionKind;
  id: string;
  label: string;
  hint?: string;
}

const MentionMenu = Extension.create<{
  source: (query: string) => Promise<MentionChoice[]>;
}>({
  name: "mentionMenu",
  addOptions: () => ({ source: async () => [] }),
  addProseMirrorPlugins() {
    let last: MentionChoice[] = [];
    const keyOf = (choice: MentionChoice) => `${choice.kind}:${choice.id}`;
    return [
      Suggestion<MentionChoice, MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey("mentionMenu"),
        char: "@",
        allowSpaces: true,
        items: async ({ query }) => {
          last = await this.options.source(query);
          return last;
        },
        command: ({ editor, range, props }) => {
          const choice = last.find((c) => keyOf(c) === props.key);
          if (!choice) return;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: "mention",
                attrs: {
                  kind: choice.kind,
                  id: choice.id,
                  label: choice.kind === "page" ? null : choice.label,
                },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: menuRender((choices: MentionChoice[]) =>
          choices.map((c) => ({
            key: keyOf(c),
            label: c.label,
            hint: c.hint,
            group:
              c.kind === "page"
                ? "Pages"
                : c.kind === "person"
                  ? "People"
                  : c.kind === "date"
                    ? "Dates"
                    : "Records",
          })),
        ),
      }),
    ];
  },
});

// --- ⌘/ turn into ----------------------------------------------------------------

/** Opens the turn-into list for the block the caret is in. */
export function openTurnInto(editor: Editor): boolean {
  const block = blockAtSelection(editor);
  const id = block?.node.attrs.id;
  if (!block || typeof id !== "string") return false;
  const name = block.node.type.name;
  const turnable = [
    "paragraph",
    "heading",
    "listItem",
    "taskItem",
    "toggle",
    "callout",
    "blockquote",
    "codeBlock",
  ].includes(name);
  if (!turnable) return false;
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  useEditorMenu.getState().open(
    TURN_INTO.map((target) => ({
      key: target.key,
      label: target.label,
      icon: BLOCK_CATALOG[target.type].icon,
    })),
    { left: coords.left, top: coords.top, bottom: coords.bottom },
    (item) => {
      const target = TURN_INTO.find((t) => t.key === item.key);
      if (target) turnBlockInto(editor, id, target);
      editor.commands.focus();
    },
  );
  return true;
}

const FlowKeys = Extension.create({
  name: "flowKeys",
  addKeyboardShortcuts() {
    return {
      "Mod-/": ({ editor }) => openTurnInto(editor),
    };
  },
  addProseMirrorPlugins() {
    // The ⌘/ list has no suggestion behind it to take its keys; an open
    // suggestion answers first, being registered before this.
    return [
      new Plugin({
        key: new PluginKey("flowMenuKeys"),
        props: {
          handleKeyDown: (_view, event) => menuOpen() && handleMenuKey(event),
        },
      }),
    ];
  },
});

export interface FlowExtensionOptions {
  views: FlowViews | null;
  mentions: (query: string) => Promise<MentionChoice[]>;
  placeholder: string;
  onTemplate?: TemplateInsertHandler;
}

export function flowExtensions(options: FlowExtensionOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false,
      underline: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Quote,
    Toggle.configure({ views: options.views }),
    Callout.configure({ views: options.views }),
    Columns,
    Column,
    AtomBlock.configure({ views: options.views }),
    Mention.configure({ views: options.views }),
    UniqueID.configure({
      attributeName: "id",
      types: BLOCK_NODE_TYPES,
      generateID: () => newId(),
    }),
    Placeholder.configure({
      placeholder: ({ editor }) => (editor.isEmpty ? options.placeholder : ""),
    }),
    SlashMenu.configure({ onTemplate: options.onTemplate ?? null }),
    MentionMenu.configure({ source: options.mentions }),
    FlowKeys,
  ];
}
