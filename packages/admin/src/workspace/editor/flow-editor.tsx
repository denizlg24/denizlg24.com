"use client";

import { type Block, ENTITY_KINDS, personGraphSchema } from "@repo/schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { cn } from "@repo/ui/utils";
import {
  type BlockOp,
  deepEqual,
  diffBlockTrees,
} from "@repo/utils/workspace-ops";
import { ancestorIds, findBlock } from "@repo/utils/workspace-tree";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import { addDays, format } from "date-fns";
import {
  Copy,
  GripVertical,
  LayoutTemplate,
  Repeat2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AdminClient } from "../../client";
import { useAdmin } from "../../provider";
import { RECORD_KINDS, searchRecords } from "../records";
import { pageTitle } from "../refs";
import { useWorkspaceStore } from "../store";
import { TemplatePicker, useTemplatePicker } from "../template-picker";
import {
  blockAt,
  blockAtSelection,
  REMOTE_META,
  replaceDocument,
  turnBlockInto,
} from "./commands";
import { blocksToDoc, canonicalBlocks, docToBlocks, TURN_INTO } from "./doc";
import {
  BLOCK_NODE_TYPES,
  type FlowViews,
  flowExtensions,
  type MentionChoice,
} from "./extensions";
import { EditorMenu } from "./menu";
import {
  AtomBlockView,
  CalloutView,
  FlowPageContext,
  MentionView,
  SectionView,
  ToggleView,
} from "./node-views";

/*
 * One TipTap editor over a page's blocks (or, for a synced block, over one
 * block of another page).
 *
 * Edits: every change marks the editor dirty; 300 ms after typing stops the
 * document is read back as blocks, diffed against the last tree this editor
 * agreed on (`diffBlockTrees`), and the ops go to the store, which applies
 * them at once and sends them batched — so typing in a paragraph is one
 * `update` of that block. Remote changes: when the store's page differs from
 * that tree, pending edits are committed first (the store replays them over
 * what the server sent, so a block being edited keeps the local version
 * and a real collision comes back as the store's 409), then only the
 * top-level nodes that differ are replaced and the caret is put back by block
 * id. The store's blocks are compared in the editor's canonical form, so a
 * shape only an agent writes (a code run with other marks, say) never reads
 * as an edit.
 */

const COMMIT_MS = 300;

const FLOW_CLASS = cn(
  "flow-editor text-sm leading-7 text-accent-strong",
  "[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-24 [&_.ProseMirror]:pb-24",
  "[&_.ProseMirror>*+*]:mt-1 [&_.ProseMirror_p]:min-h-7",
  "[&_.ProseMirror_h1]:mt-6 [&_.ProseMirror_h1]:text-[1.6rem] [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h1]:leading-tight",
  "[&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:leading-snug",
  "[&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold",
  "[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0",
  "[&_li[data-checked]]:flex [&_li[data-checked]]:gap-2 [&_li[data-checked]>label]:mt-[0.35rem] [&_li[data-checked]>div]:min-w-0 [&_li[data-checked]>div]:flex-1",
  "[&_li[data-checked=true]>div>p:first-child]:text-muted-foreground [&_li[data-checked=true]>div>p:first-child]:line-through",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-accent-strong/60 [&_blockquote]:pl-4",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:bg-surface [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-relaxed",
  "[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-surface [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.85em]",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_a]:underline [&_a]:decoration-muted-foreground/50 [&_a]:underline-offset-2",
  "[&_.flow-columns]:flex [&_.flow-columns]:flex-col [&_.flow-columns]:gap-6 @3xl:[&_.flow-columns]:flex-row @3xl:[&_.flow-columns]:gap-10",
  "[&_.flow-column]:min-w-0",
  "[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground/50 [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
  "[&_.ProseMirror-selectednode]:outline-none",
);

function scoped(blocks: readonly Block[], scope: string | undefined): Block[] {
  if (!scope) return [...blocks];
  const location = findBlock(blocks, scope);
  return location ? [location.block] : [];
}

/**
 * Ops diffed over a synced block's one-block document, placed in its real
 * page: its top level is the source block's siblings, right where it sits.
 */
function placeScoped(
  ops: BlockOp[],
  blocks: readonly Block[],
  scope: string | undefined,
): BlockOp[] {
  if (!scope) return ops;
  const location = findBlock(blocks, scope);
  if (!location) return [];
  const before =
    location.index > 0
      ? (location.siblings[location.index - 1]?.id ?? null)
      : null;
  return ops.map((op) => {
    if ((op.op !== "insert" && op.op !== "move") || op.parentId) return op;
    return {
      ...op,
      ...(location.parentId ? { parentId: location.parentId } : {}),
      after: op.after === null ? before : op.after,
    };
  });
}

let peopleCache: Promise<{ id: string; name: string }[]> | null = null;

function people(client: AdminClient) {
  peopleCache ??= client
    .get("people")
    .then((body) =>
      personGraphSchema
        .pick({ people: true })
        .parse(body)
        .people.map((p) => ({ id: p._id, name: p.name })),
    )
    .catch(() => {
      peopleCache = null;
      return [];
    });
  return peopleCache;
}

function useMentionSource(): (query: string) => Promise<MentionChoice[]> {
  const { client } = useAdmin();
  return useCallback(
    async (query: string) => {
      const q = query.trim().toLowerCase();
      const pages = Object.values(useWorkspaceStore.getState().workspace.pages)
        .filter(
          (p) =>
            !p.deletedAt &&
            !p.template &&
            pageTitle(p).toLowerCase().includes(q),
        )
        .slice(0, 6)
        .map((p) => ({ kind: "page" as const, id: p.id, label: pageTitle(p) }));
      const found = (await people(client))
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map((p) => ({ kind: "person" as const, id: p.id, label: p.name }));
      const today = new Date();
      const dates = [
        { label: "Today", date: today },
        { label: "Tomorrow", date: addDays(today, 1) },
        { label: "Yesterday", date: addDays(today, -1) },
      ]
        .filter((d) => !q || d.label.toLowerCase().startsWith(q))
        .map((d) => ({
          kind: "date" as const,
          id: format(d.date, "yyyy-MM-dd"),
          label: format(d.date, "MMM d, yyyy"),
          hint: d.label,
        }));
      const literal = /^\d{4}-\d{2}-\d{2}$/.test(q)
        ? [{ kind: "date" as const, id: q, label: q }]
        : [];
      const records: MentionChoice[] =
        q.length >= 2
          ? (
              await searchRecords(
                client,
                q,
                ENTITY_KINDS.filter((k) => k !== "page" && k !== "person"),
              ).catch(() => [])
            ).map((record) => ({
              kind: record.kind,
              id: record.id,
              label: record.title,
              hint: RECORD_KINDS[record.kind].label,
            }))
          : [];
      return [...pages, ...found, ...dates, ...literal, ...records];
    },
    [client],
  );
}

const VIEWS: FlowViews = {
  toggle: ReactNodeViewRenderer(ToggleView),
  callout: ReactNodeViewRenderer(CalloutView),
  atomBlock: ReactNodeViewRenderer(AtomBlockView),
  mention: ReactNodeViewRenderer(MentionView, { as: "span" }),
  section: ReactNodeViewRenderer(SectionView),
};

export function FlowEditor({
  pageId,
  scope,
  editable,
  depth = 0,
}: {
  pageId: string;
  /** A block id: edit only that block of the page (a synced block's view). */
  scope?: string;
  editable: boolean;
  depth?: number;
}) {
  const ensurePage = useWorkspaceStore((s) => s.ensurePage);
  const ready = useWorkspaceStore((s) => s.ready && pageId in s.loaded);
  useEffect(() => {
    void ensurePage(pageId);
  }, [ensurePage, pageId]);
  if (!ready) return null;
  return (
    <FlowPageContext.Provider value={{ pageId, depth }}>
      <LoadedEditor
        key={`${pageId}:${scope ?? ""}`}
        pageId={pageId}
        scope={scope}
        editable={editable}
        root={depth === 0}
      />
    </FlowPageContext.Provider>
  );
}

function LoadedEditor({
  pageId,
  scope,
  editable,
  root,
}: {
  pageId: string;
  scope?: string;
  editable: boolean;
  root: boolean;
}) {
  const editBlocks = useWorkspaceStore((s) => s.editBlocks);
  const blocks = useWorkspaceStore((s) => s.workspace.pages[pageId]?.blocks);
  const mentions = useMentionSource();
  const initial = useMemo(
    () =>
      canonicalBlocks(
        scoped(
          useWorkspaceStore.getState().workspace.pages[pageId]?.blocks ?? [],
          scope,
        ),
      ),
    [pageId, scope],
  );
  const agreed = useRef<Block[]>(initial);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const editor = editorRef.current;
    if (!editor || !dirty.current) return;
    dirty.current = false;
    const next = docToBlocks(editor.getJSON());
    const ops = diffBlockTrees(agreed.current, next);
    agreed.current = next;
    if (ops.length === 0) return;
    const current =
      useWorkspaceStore.getState().workspace.pages[pageId]?.blocks ?? [];
    editBlocks(pageId, placeScoped(ops, current, scope));
  }, [editBlocks, pageId, scope]);

  const insertTemplate = useWorkspaceStore((s) => s.insertTemplate);
  const openTemplates = useTemplatePicker((s) => s.open);
  const onTemplate = useCallback(
    (editor: Editor) => {
      const id = blockAtSelection(editor)?.node.attrs.id;
      commit();
      const blocks =
        useWorkspaceStore.getState().workspace.pages[pageId]?.blocks ?? [];
      const top =
        typeof id === "string" && findBlock(blocks, id)
          ? ([id, ...ancestorIds(blocks, id)].at(-1) ?? null)
          : null;
      openTemplates({
        use: "insert",
        onPick: async (templateId, inputs) => {
          await insertTemplate(
            pageId,
            templateId,
            top ? { after: top } : {},
            inputs,
          );
        },
      });
    },
    [commit, insertTemplate, openTemplates, pageId],
  );

  const extensions = useMemo(
    () =>
      flowExtensions({
        views: VIEWS,
        mentions,
        placeholder: "Write…",
        ...(root && !scope ? { onTemplate } : {}),
      }),
    [mentions, onTemplate, root, scope],
  );

  const editor = useEditor(
    {
      extensions,
      content: blocksToDoc(initial),
      editable,
      immediatelyRender: false,
      onUpdate: ({ transaction }) => {
        if (transaction.getMeta(REMOTE_META)) return;
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, COMMIT_MS);
      },
      onBlur: () => commit(),
    },
    [extensions],
  );
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => () => commit(), [commit]);

  useEffect(() => {
    if (!editor || !blocks) return;
    if (deepEqual(canonicalBlocks(scoped(blocks, scope)), agreed.current))
      return;
    // Our own unsent keystrokes first; the store replays them over the remote copy.
    commit();
    const latest =
      useWorkspaceStore.getState().workspace.pages[pageId]?.blocks ?? [];
    const canonical = canonicalBlocks(scoped(latest, scope));
    if (deepEqual(canonical, agreed.current)) return;
    replaceDocument(editor, blocksToDoc(canonical), { remote: true });
    agreed.current = canonical;
  }, [editor, blocks, scope, pageId, commit]);

  return (
    <div className="group/flow @container relative">
      {editor && editable ? (
        <BlockHandle
          editor={editor}
          pageId={scope ? null : pageId}
          beforeAction={commit}
        />
      ) : null}
      <EditorContent editor={editor} className={FLOW_CLASS} />
      {root ? <EditorMenu /> : null}
      {root ? <TemplatePicker use="insert" /> : null}
    </div>
  );
}

// --- drag handle and block menu -----------------------------------------------------

interface Target {
  pos: number;
  top: number;
  left: number;
}

function BlockHandle({
  editor,
  pageId,
  beforeAction,
}: {
  editor: Editor;
  /** The page the blocks belong to; null in a synced block's editor. */
  pageId: string | null;
  /** Commits pending typing before an action that goes to the server. */
  beforeAction: () => void;
}) {
  const saveBlocksAsTemplate = useWorkspaceStore((s) => s.saveBlocksAsTemplate);
  const [target, setTarget] = useState<Target | null>(null);
  const [menu, setMenu] = useState(false);
  const handle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const view = editor.view;
    const container = view.dom.parentElement?.parentElement;
    if (!container) return;
    const move = (event: MouseEvent) => {
      if (menu) return;
      if (
        event.target instanceof Node &&
        handle.current?.contains(event.target)
      )
        return;
      const box = view.dom.getBoundingClientRect();
      const coords = view.posAtCoords({
        left: Math.max(event.clientX, box.left + 4),
        top: event.clientY,
      });
      if (!coords) return;
      const { doc } = view.state;
      const atom = coords.inside >= 0 ? doc.nodeAt(coords.inside) : null;
      const block =
        atom &&
        (atom.isAtom || atom.type.name === "horizontalRule") &&
        BLOCK_NODE_TYPES.includes(atom.type.name)
          ? { node: atom, pos: coords.inside }
          : blockAt(doc, coords.pos);
      if (!block) return;
      const dom = view.nodeDOM(block.pos);
      if (!(dom instanceof HTMLElement)) return;
      const rect = dom.getBoundingClientRect();
      const outer = container.getBoundingClientRect();
      setTarget({
        pos: block.pos,
        top: rect.top - outer.top,
        left: rect.left - outer.left,
      });
    };
    container.addEventListener("mousemove", move);
    return () => container.removeEventListener("mousemove", move);
  }, [editor, menu]);

  if (!target) return null;
  const node = editor.state.doc.nodeAt(target.pos);
  const id = node?.attrs.id;
  const turnable =
    node &&
    [
      "paragraph",
      "heading",
      "listItem",
      "taskItem",
      "toggle",
      "callout",
      "blockquote",
      "codeBlock",
    ].includes(node.type.name);

  return (
    <DropdownMenu open={menu} onOpenChange={setMenu}>
      <DropdownMenuTrigger asChild>
        <button
          ref={handle}
          type="button"
          draggable
          aria-label="Block"
          style={{ top: target.top + 4, left: target.left - 22 }}
          onDragStart={(event) => {
            const view = editor.view;
            const current = view.state.doc.nodeAt(target.pos);
            if (!current) return;
            const selection = NodeSelection.create(view.state.doc, target.pos);
            view.dispatch(view.state.tr.setSelection(selection));
            view.dragging = { slice: selection.content(), move: true };
            const dom = view.nodeDOM(target.pos);
            if (dom instanceof HTMLElement)
              event.dataTransfer.setDragImage(dom, 0, 0);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", current.textContent);
          }}
          className="absolute z-10 flex h-5 w-4 cursor-grab items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-opacity hover:bg-surface hover:text-muted-foreground active:cursor-grabbing group-hover/flow:opacity-100 data-[state=open]:opacity-100"
        >
          <GripVertical className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {turnable && typeof id === "string" ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Repeat2 />
              Turn into
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {TURN_INTO.map((t) => (
                <DropdownMenuItem
                  key={t.key}
                  onSelect={() => turnBlockInto(editor, id, t)}
                >
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuItem
          onSelect={() => {
            const current = editor.state.doc.nodeAt(target.pos);
            if (!current) return;
            const at = target.pos + current.nodeSize;
            editor.view.dispatch(editor.state.tr.insert(at, current));
          }}
        >
          <Copy />
          Duplicate
        </DropdownMenuItem>
        {pageId && typeof id === "string" ? (
          <DropdownMenuItem
            onSelect={() => {
              const current = editor.state.doc.nodeAt(target.pos);
              beforeAction();
              const title = current?.textContent.trim().slice(0, 80) ?? "";
              void saveBlocksAsTemplate(pageId, [id], title).then((saved) => {
                if (saved) toast.success("Saved as template");
              });
            }}
          >
            <LayoutTemplate />
            Save as template
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            const current = editor.state.doc.nodeAt(target.pos);
            if (!current) return;
            editor.view.dispatch(
              editor.state.tr.delete(target.pos, target.pos + current.nodeSize),
            );
            setTarget(null);
          }}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
