"use client";

import {
  type Block,
  type BlockOf,
  blockSchema,
  CALLOUT_COLORS,
  type CalloutColor,
  entityRef,
  isTextBlock,
  isWidgetType,
  mentionKindSchema,
  type RichText,
  workspaceUnfurlSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { cn } from "@repo/ui/utils";
import { plainText, textRuns } from "@repo/utils/workspace-rich-text";
import { walkBlocks } from "@repo/utils/workspace-tree";
import {
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
} from "@tiptap/react";
import { format, parseISO } from "date-fns";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  ArrowUpRight,
  ChevronRight,
  Minus,
  Paperclip,
  Plus,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useAdmin } from "../../provider";
import { BLOCK_CATALOG } from "../block-catalog";
import { BlockBody, type WidgetBlock } from "../blocks";
import { IconPicker, PageIcon } from "../page-icon";
import { RecordBlock } from "../record-embed";
import { recordHref, useRecord } from "../records";
import { pageTitle } from "../refs";
import { pageAncestors, useWorkspaceStore } from "../store";
import { useWorkspaceNav } from "../use-workspace-nav";
import { ViewBlock } from "../views/view-block";
import { FlowEditor } from "./flow-editor";

/** The page an editor shows, for node views that read their surroundings. */
export const FlowPageContext = createContext<{ pageId: string; depth: number }>(
  {
    pageId: "",
    depth: 0,
  },
);

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

// --- toggle -------------------------------------------------------------------

const TOGGLE_TEXT: Record<number, string> = {
  1: "[&>[data-node-view-content]>p:first-child]:text-[1.6rem] [&>[data-node-view-content]>p:first-child]:font-semibold",
  2: "[&>[data-node-view-content]>p:first-child]:text-xl [&>[data-node-view-content]>p:first-child]:font-semibold",
  3: "[&>[data-node-view-content]>p:first-child]:text-base [&>[data-node-view-content]>p:first-child]:font-semibold",
};

export function ToggleView({ node }: NodeViewProps) {
  const [open, setOpen] = useState(true);
  const level = typeof node.attrs.level === "number" ? node.attrs.level : 0;
  return (
    <NodeViewWrapper
      data-id={node.attrs.id}
      data-open={open}
      className={cn(
        "relative pl-6",
        TOGGLE_TEXT[level],
        !open && "[&>[data-node-view-content]>*:not(:first-child)]:hidden",
      )}
    >
      <button
        type="button"
        contentEditable={false}
        aria-label={open ? "Collapse" : "Expand"}
        onClick={() => setOpen((o) => !o)}
        className="absolute top-[0.3em] left-0 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-surface"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

// --- callout ------------------------------------------------------------------

const CALLOUT_TONE: Record<CalloutColor, string> = {
  default: "bg-surface",
  gray: "bg-muted/60",
  brown: "bg-status-serious/8",
  orange: "bg-status-serious/12",
  yellow: "bg-status-warning/15",
  green: "bg-status-good/12",
  blue: "bg-status-info/12",
  purple: "bg-status-info/20",
  pink: "bg-status-critical/8",
  red: "bg-status-critical/12",
};

function calloutColor(value: unknown): CalloutColor {
  return CALLOUT_COLORS.find((c) => c === value) ?? "default";
}

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const color = calloutColor(node.attrs.color);
  const emoji = typeof node.attrs.emoji === "string" ? node.attrs.emoji : "💡";
  return (
    <NodeViewWrapper
      data-id={node.attrs.id}
      className={cn("flex gap-3 rounded-md px-4 py-3", CALLOUT_TONE[color])}
    >
      <div contentEditable={false} className="flex shrink-0 flex-col gap-1">
        {editor.isEditable ? (
          <IconPicker
            value={emoji}
            onChange={(icon) => updateAttributes({ emoji: icon ?? "💡" })}
          >
            <button
              type="button"
              aria-label="Icon"
              className="text-lg leading-7"
            >
              {emoji}
            </button>
          </IconPicker>
        ) : (
          <span className="text-lg leading-7">{emoji}</span>
        )}
        {editor.isEditable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Colour"
                className={cn(
                  "mx-auto size-2.5 rounded-full border",
                  CALLOUT_TONE[color],
                )}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {CALLOUT_COLORS.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onSelect={() => updateAttributes({ color: c })}
                >
                  <span
                    className={cn(
                      "size-3 rounded-full border",
                      CALLOUT_TONE[c],
                    )}
                  />
                  {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}

// --- mention ------------------------------------------------------------------

export function MentionView({ node }: NodeViewProps) {
  const nav = useWorkspaceNav();
  const kind = mentionKindSchema.safeParse(node.attrs.kind);
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
  const label = typeof node.attrs.label === "string" ? node.attrs.label : null;
  const page = useWorkspaceStore((s) =>
    kind.data === "page" ? s.workspace.pages[id] : undefined,
  );
  const record =
    kind.success && kind.data !== "page" && kind.data !== "date"
      ? entityRef(kind.data, id)
      : null;
  const state = useRecord(record);
  const chip =
    "rounded px-0.5 text-accent-strong decoration-muted-foreground/50 underline underline-offset-2 hover:bg-surface";
  let content: React.ReactNode;
  if (kind.data === "page") {
    content = page ? (
      <Link
        href={nav.pageHref(id)}
        className={cn(chip, "inline-flex items-baseline gap-1")}
      >
        <PageIcon icon={page.icon} className="size-3.5 self-center" />
        {pageTitle(page)}
      </Link>
    ) : (
      <span className="text-muted-foreground line-through">{label ?? id}</span>
    );
  } else if (kind.data === "date") {
    let text = id;
    try {
      text = format(parseISO(id), "MMM d, yyyy");
    } catch {}
    content = <span className="text-muted-foreground">@{text}</span>;
  } else if (record && state.status === "missing") {
    content = (
      <span className="text-muted-foreground line-through">@{label ?? id}</span>
    );
  } else if (record) {
    const href = recordHref(nav, record);
    const text = `@${state.status === "ready" ? state.record.title : (label ?? id)}`;
    content = href ? (
      <Link href={href} data-mention={record} className={chip}>
        {text}
      </Link>
    ) : (
      <span data-mention={record} className="text-accent-strong">
        {text}
      </span>
    );
  } else {
    content = <span className="text-accent-strong">@{label ?? id}</span>;
  }
  return (
    <NodeViewWrapper as="span" className="inline">
      {content}
    </NodeViewWrapper>
  );
}

// --- atoms: widgets, media, tables, synced ------------------------------------

function blockFromNode(node: NodeViewProps["node"]): Block | null {
  const data = node.attrs.data;
  const parsed = blockSchema.safeParse({
    ...(typeof data === "object" && data !== null ? data : {}),
    id: node.attrs.id ?? "",
    type: node.attrs.blockType,
  });
  return parsed.success ? parsed.data : null;
}

function isWidgetBlock(block: Block): block is WidgetBlock {
  return isWidgetType(block.type);
}

function fieldsOf(block: Block): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = block;
  return rest;
}

interface AtomProps<T extends Block["type"]> {
  block: BlockOf<T>;
  editable: boolean;
  selected: boolean;
  onChange: (block: BlockOf<T>) => void;
}

function WidgetFrame({
  block,
  editable,
  selected,
  onChange,
}: AtomProps<WidgetBlock["type"]>) {
  const { pageId } = useContext(FlowPageContext);
  const nav = useWorkspaceNav();
  const meta = BLOCK_CATALOG[block.type];
  const label = block.title ?? (meta.headerless ? "" : meta.label);
  const href = meta.href?.(nav);
  const editing = editable && selected;
  return (
    <div className="flex flex-col gap-3 py-1">
      {label || (editing && !meta.headerless) ? (
        <div className="flex min-h-6 items-center gap-3">
          {editing ? (
            <input
              defaultValue={label}
              placeholder={meta.label}
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                const title = value === meta.label ? undefined : value;
                if (title !== block.title) onChange({ ...block, title });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className={cn(
                LABEL,
                "w-40 min-w-0 bg-transparent outline-none focus:text-accent-strong",
              )}
            />
          ) : href ? (
            <Link
              href={href}
              className={cn(
                LABEL,
                "group/label flex shrink-0 items-center gap-1 hover:text-accent-strong",
              )}
            >
              {label}
              <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover/label:opacity-100" />
            </Link>
          ) : (
            <span className={cn(LABEL, "shrink-0")}>{label}</span>
          )}
          <div className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <BlockBody
        block={block}
        pageId={pageId}
        editing={editing}
        onChange={onChange}
      />
    </div>
  );
}

const uploadSchema = z.object({ url: z.string() });

function useUpload() {
  const { client } = useAdmin();
  return async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return uploadSchema.parse(await client.upload("upload", form)).url;
  };
}

function UrlField({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (url: string) => void;
}) {
  return (
    <input
      placeholder={placeholder}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        const value = event.currentTarget.value.trim();
        if (/^https?:\/\//.test(value)) onSubmit(value);
      }}
      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
    />
  );
}

function UploadButton({
  accept,
  onFile,
}: {
  accept?: string;
  onFile: (file: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Upload />
        {busy ? "Uploading" : "Upload"}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            await onFile(file);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function EmptyMedia({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-dashed py-2 text-muted-foreground">
      {children}
    </div>
  );
}

function ImageAtom({ block, editable, onChange }: AtomProps<"image">) {
  const upload = useUpload();
  if (!block.url) {
    if (!editable) return null;
    return (
      <EmptyMedia>
        <UploadButton
          accept="image/*"
          onFile={async (file) =>
            onChange({ ...block, url: await upload(file) })
          }
        />
        <UrlField
          placeholder="Image URL"
          onSubmit={(url) => onChange({ ...block, url })}
        />
      </EmptyMedia>
    );
  }
  return (
    <figure className="flex flex-col gap-1.5">
      <img
        src={block.url}
        alt={plainText(block.caption)}
        className="max-h-[36rem] w-auto max-w-full rounded-sm object-contain"
      />
      {editable ? (
        <input
          defaultValue={plainText(block.caption)}
          placeholder="Caption"
          onBlur={(event) => {
            const caption = textRuns(event.currentTarget.value);
            if (plainText(caption) !== plainText(block.caption))
              onChange({ ...block, caption });
          }}
          className="bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/40"
        />
      ) : block.caption.length > 0 ? (
        <figcaption className="text-xs text-muted-foreground">
          {plainText(block.caption)}
        </figcaption>
      ) : null}
    </figure>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function FileAtom({ block, editable, onChange }: AtomProps<"file">) {
  const upload = useUpload();
  if (!block.url) {
    if (!editable) return null;
    return (
      <EmptyMedia>
        <UploadButton
          onFile={async (file) =>
            onChange({
              ...block,
              url: await upload(file),
              name: file.name,
              size: file.size,
            })
          }
        />
      </EmptyMedia>
    );
  }
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-sm py-1 text-sm hover:bg-surface"
    >
      <Paperclip className="size-4 text-muted-foreground" />
      <span className="min-w-0 truncate text-accent-strong">
        {block.name || block.url}
      </span>
      {block.size !== undefined ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatBytes(block.size)}
        </span>
      ) : null}
    </a>
  );
}

const unfurlResponseSchema = z.object({ bookmark: workspaceUnfurlSchema });

function BookmarkAtom({ block, editable, onChange }: AtomProps<"bookmark">) {
  const { client } = useAdmin();
  const [failed, setFailed] = useState<string | null>(null);
  const unfurl = async (url: string) => {
    setFailed(null);
    onChange({ ...block, url });
    try {
      const { bookmark } = unfurlResponseSchema.parse(
        await client.post("workspace/unfurl", { url }),
      );
      onChange({
        ...block,
        url,
        title: bookmark.title,
        description: bookmark.description,
        image: bookmark.image,
        siteName: bookmark.siteName,
      });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "Failed");
    }
  };
  if (!block.url) {
    if (!editable) return null;
    return (
      <EmptyMedia>
        <UrlField placeholder="https://" onSubmit={(url) => void unfurl(url)} />
      </EmptyMedia>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group/bm flex items-stretch gap-4 border-b py-2 hover:bg-surface/70"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-accent-strong">
            {block.title ?? block.url}
          </span>
          {block.description ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {block.description}
            </span>
          ) : null}
          <span className="truncate text-xs text-muted-foreground">
            {block.siteName ?? block.url}
          </span>
        </div>
        {block.image ? (
          <img
            src={block.image}
            alt=""
            className="h-16 w-28 shrink-0 rounded-sm object-cover"
          />
        ) : null}
      </a>
      {failed ? (
        <span className="text-xs text-destructive">{failed}</span>
      ) : null}
    </div>
  );
}

function EquationAtom({
  block,
  editable,
  selected,
  onChange,
}: AtomProps<"equation">) {
  const html = useMemo(
    () =>
      katex.renderToString(block.expression || "\\square", {
        displayMode: true,
        throwOnError: false,
      }),
    [block.expression],
  );
  return (
    <div className="flex flex-col gap-1">
      <div
        className="overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {editable && (selected || !block.expression) ? (
        <textarea
          defaultValue={block.expression}
          placeholder="\int_0^1 x\,dx"
          onBlur={(event) => {
            const expression = event.currentTarget.value;
            if (expression !== block.expression)
              onChange({ ...block, expression });
          }}
          className="field-sizing-content min-h-8 w-full resize-none bg-surface/60 px-2 py-1 font-mono text-xs outline-none"
        />
      ) : null}
    </div>
  );
}

function TableAtom({ block, editable, onChange }: AtomProps<"table">) {
  const width = Math.max(1, ...block.rows.map((row) => row.length));
  const setCell = (r: number, c: number, text: RichText) =>
    onChange({
      ...block,
      rows: block.rows.map((row, ri) =>
        ri === r
          ? Array.from({ length: width }, (_, ci) =>
              ci === c ? text : (row[ci] ?? []),
            )
          : row,
      ),
    });
  return (
    <div className="flex flex-col gap-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-b">
              {Array.from({ length: width }, (_, c) => {
                const header = block.headerRow && r === 0;
                const value = plainText(row[c] ?? []);
                return (
                  <td
                    key={c}
                    className={cn(
                      "px-2 py-1.5 align-top",
                      header && "font-medium text-accent-strong",
                    )}
                  >
                    {editable ? (
                      <input
                        defaultValue={value}
                        onBlur={(event) => {
                          if (event.currentTarget.value !== value) {
                            setCell(r, c, textRuns(event.currentTarget.value));
                          }
                        }}
                        className="w-full min-w-16 bg-transparent outline-none"
                      />
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {editable ? (
        <div className="flex gap-1 text-muted-foreground">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...block,
                rows: [...block.rows, Array.from({ length: width }, () => [])],
              })
            }
          >
            <Plus />
            Row
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...block,
                rows: block.rows.map((row) => [...row, []]),
              })
            }
          >
            <Plus />
            Column
          </Button>
          {block.rows.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({ ...block, rows: block.rows.slice(0, -1) })
              }
            >
              <Minus />
              Row
            </Button>
          ) : null}
          {width > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...block,
                  rows: block.rows.map((row) => row.slice(0, width - 1)),
                })
              }
            >
              <Minus />
              Column
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TocAtom() {
  const { pageId } = useContext(FlowPageContext);
  const blocks = useWorkspaceStore((s) => s.workspace.pages[pageId]?.blocks);
  const headings = useMemo(() => {
    const out: { id: string; level: number; text: string }[] = [];
    walkBlocks(blocks ?? [], (block) => {
      if (block.type === "heading")
        out.push({
          id: block.id,
          level: block.level,
          text: plainText(block.text),
        });
      if (block.type === "toggle" && block.level)
        out.push({
          id: block.id,
          level: block.level,
          text: plainText(block.text),
        });
    });
    return out;
  }, [blocks]);
  if (headings.length === 0)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <nav className="flex flex-col">
      {headings.map((h) => (
        <button
          key={h.id}
          type="button"
          onClick={() =>
            document
              .querySelector(`[data-id="${CSS.escape(h.id)}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          style={{ paddingLeft: `${(h.level - 1) * 0.875}rem` }}
          className="truncate py-0.5 text-left text-sm text-muted-foreground underline-offset-2 hover:text-accent-strong hover:underline"
        >
          {h.text || "—"}
        </button>
      ))}
    </nav>
  );
}

function BreadcrumbAtom() {
  const { pageId } = useContext(FlowPageContext);
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const { pageHref } = useWorkspaceNav();
  const page = pages[pageId];
  if (!page) return null;
  const chain = [...pageAncestors(pages, pageId), page];
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {chain.map((p, i) => (
        <span key={p.id} className="flex items-center gap-1">
          {i > 0 ? <span className="text-muted-foreground/50">/</span> : null}
          <Link
            href={pageHref(p.id)}
            className="flex items-center gap-1 rounded px-1 hover:bg-surface hover:text-accent-strong"
          >
            <PageIcon icon={p.icon} className="size-3.5" />
            {pageTitle(p)}
          </Link>
        </span>
      ))}
    </nav>
  );
}

function SyncedAtom({ block, editable, onChange }: AtomProps<"synced">) {
  const { depth } = useContext(FlowPageContext);
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const ensurePage = useWorkspaceStore((s) => s.ensurePage);
  const source = block.pageId ? pages[block.pageId] : undefined;
  const choices = useMemo(() => {
    if (!source) return [];
    const out: { id: string; label: string }[] = [];
    for (const b of source.blocks) {
      out.push({
        id: b.id,
        label: isTextBlock(b)
          ? plainText(b.text) || BLOCK_CATALOG[b.type].label
          : BLOCK_CATALOG[b.type].label,
      });
    }
    return out;
  }, [source]);

  if (!block.pageId || !block.blockId) {
    if (!editable) return null;
    return (
      <EmptyMedia>
        <select
          value={block.pageId}
          onChange={(event) => {
            void ensurePage(event.currentTarget.value);
            onChange({
              ...block,
              pageId: event.currentTarget.value,
              blockId: "",
            });
          }}
          className="max-w-48 bg-transparent text-sm outline-none"
        >
          <option value="">Page</option>
          {Object.values(pages)
            .filter((p) => !p.deletedAt)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {pageTitle(p)}
              </option>
            ))}
        </select>
        {block.pageId ? (
          <select
            value=""
            onChange={(event) =>
              onChange({ ...block, blockId: event.currentTarget.value })
            }
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          >
            <option value="">Block</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label.slice(0, 80)}
              </option>
            ))}
          </select>
        ) : null}
      </EmptyMedia>
    );
  }
  if (depth >= 2) {
    return (
      <span className="text-xs text-muted-foreground">
        ↻ {source ? pageTitle(source) : block.pageId}
      </span>
    );
  }
  return (
    <SyncedSource
      pageId={block.pageId}
      blockId={block.blockId}
      editable={editable}
    />
  );
}

function SyncedSource({
  pageId,
  blockId,
  editable,
}: {
  pageId: string;
  blockId: string;
  editable: boolean;
}) {
  const { depth } = useContext(FlowPageContext);
  return (
    <div className="border-l-2 border-status-info/40 pl-3">
      <FlowEditor
        pageId={pageId}
        scope={blockId}
        editable={editable}
        depth={depth + 1}
      />
    </div>
  );
}

export function AtomBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const block = blockFromNode(node);
  const editable = editor.isEditable;
  const onChange = (next: Block) => updateAttributes({ data: fieldsOf(next) });
  let body: React.ReactNode = null;
  if (block) {
    if (isWidgetBlock(block)) {
      body = (
        <WidgetFrame
          block={block}
          editable={editable}
          selected={selected}
          onChange={onChange}
        />
      );
    } else {
      switch (block.type) {
        case "image":
          body = (
            <ImageAtom
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
            />
          );
          break;
        case "file":
          body = (
            <FileAtom
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
            />
          );
          break;
        case "bookmark":
          body = (
            <BookmarkAtom
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
            />
          );
          break;
        case "equation":
          body = (
            <EquationAtom
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
            />
          );
          break;
        case "table":
          body = (
            <TableAtom
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
            />
          );
          break;
        case "toc":
          body = <TocAtom />;
          break;
        case "breadcrumb":
          body = <BreadcrumbAtom />;
          break;
        case "synced":
          body = (
            <SyncedAtom
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
            />
          );
          break;
        case "record":
          body = (
            <RecordBlock
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
              onMention={(record) => {
                const pos = getPos();
                if (typeof pos !== "number") return;
                editor
                  .chain()
                  .focus()
                  .insertContentAt(
                    { from: pos, to: pos + node.nodeSize },
                    {
                      type: "paragraph",
                      attrs: { id: block.id },
                      content: [
                        {
                          type: "mention",
                          attrs: {
                            kind: record.kind,
                            id: record.id,
                            label: record.kind === "page" ? null : record.title,
                          },
                        },
                        { type: "text", text: " " },
                      ],
                    },
                  )
                  .run();
              }}
            />
          );
          break;
        case "view":
          body = (
            <ViewBlock
              block={block}
              editable={editable}
              selected={selected}
              onChange={onChange}
            />
          );
          break;
        default:
          body = null;
      }
    }
  }
  return (
    <NodeViewWrapper
      data-id={node.attrs.id}
      className={cn(
        "my-1 rounded-sm",
        selected && editable && "outline-1 outline-offset-4 outline-border",
      )}
    >
      {body}
    </NodeViewWrapper>
  );
}
