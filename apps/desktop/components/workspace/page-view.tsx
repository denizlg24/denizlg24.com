"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { cn } from "@repo/ui/utils";
import {
  ArrowUpRight,
  Check,
  Copy,
  GripVertical,
  Lock,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pageHref, pageTitle } from "@/lib/workspace/refs";
import type { Block, BlockSpan, WorkspacePage } from "@/lib/workspace/schema";
import { createBlock } from "@/lib/workspace/seed";
import { pageAncestors, useWorkspaceStore } from "@/stores/workspace";
import { BLOCK_CATALOG } from "./block-catalog";
import { BlockPicker } from "./block-picker";
import { BlockBody } from "./blocks";
import { PageMenuItems } from "./page-actions";
import { IconPicker, PageIcon } from "./page-icon";
import { SidebarTrigger } from "./sidebar-trigger";

const SPAN_CLASS: Record<BlockSpan, string> = {
  2: "@3xl:col-span-2",
  3: "@3xl:col-span-3",
  4: "@3xl:col-span-4",
  6: "@3xl:col-span-6",
};

const SPAN_LABEL: Record<BlockSpan, string> = {
  2: "Third",
  3: "Half",
  4: "Two thirds",
  6: "Full",
};

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function BlockFrame({
  block,
  pageId,
  editing,
}: {
  block: Block;
  pageId: string;
  editing: boolean;
}) {
  const updateBlock = useWorkspaceStore((s) => s.updateBlock);
  const removeBlock = useWorkspaceStore((s) => s.removeBlock);
  const duplicateBlock = useWorkspaceStore((s) => s.duplicateBlock);
  const setBlockSpan = useWorkspaceStore((s) => s.setBlockSpan);
  const sortable = useSortable({ id: block.id, disabled: !editing });
  const meta = BLOCK_CATALOG[block.type];
  const label = block.title ?? (meta.headerless ? "" : meta.label);

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "group/block relative col-span-1 flex min-w-0 flex-col gap-3",
        SPAN_CLASS[block.span],
        editing &&
          "rounded-lg p-3 -m-3 outline-1 outline-dashed outline-transparent hover:outline-border",
        sortable.isDragging && "z-20 bg-background opacity-80 outline-border",
      )}
    >
      {editing ? (
        <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover/block:opacity-100 has-data-[state=open]:opacity-100">
          <button
            type="button"
            aria-label="Drag to reorder"
            className="flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-surface active:cursor-grabbing"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Block options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Width
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(block.span)}
                onValueChange={(value) => {
                  const span = ([2, 3, 4, 6] as const).find(
                    (s) => String(s) === value,
                  );
                  if (span) setBlockSpan(pageId, block.id, span);
                }}
              >
                {([2, 3, 4, 6] as const).map((span) => (
                  <DropdownMenuRadioItem key={span} value={String(span)}>
                    {SPAN_LABEL[span]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {!meta.headerless ? (
                <DropdownMenuCheckboxItem
                  checked={block.title !== ""}
                  onCheckedChange={(checked) =>
                    updateBlock(pageId, {
                      ...block,
                      title: checked ? undefined : "",
                    })
                  }
                >
                  Show title
                </DropdownMenuCheckboxItem>
              ) : null}
              <DropdownMenuItem
                onSelect={() => duplicateBlock(pageId, block.id)}
              >
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => removeBlock(pageId, block.id)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {label || (editing && !meta.headerless) ? (
        <div className="flex min-h-6 items-center gap-3">
          {editing ? (
            <input
              defaultValue={label}
              placeholder={meta.label}
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                const title =
                  value === meta.label ? undefined : value || undefined;
                if (title !== block.title)
                  updateBlock(pageId, { ...block, title });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="w-40 min-w-0 bg-transparent text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground outline-none focus:text-accent-strong"
            />
          ) : meta.href ? (
            <Link
              href={meta.href}
              className="group/label flex shrink-0 items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent-strong"
            >
              {label}
              <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover/label:opacity-100" />
            </Link>
          ) : (
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </span>
          )}
          <div className="h-px flex-1 bg-border" />
        </div>
      ) : null}

      <BlockBody
        block={block}
        pageId={pageId}
        editing={editing}
        onChange={(next) => updateBlock(pageId, next)}
      />
    </div>
  );
}

function TitleArea({ page }: { page: WorkspacePage }) {
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  const [title, setTitle] = useState(page.title);

  useEffect(() => setTitle(page.title), [page.title]);

  return (
    <div className="flex flex-col gap-3 pt-6">
      <IconPicker
        value={page.icon}
        onChange={(icon) => updatePage(page.id, { icon })}
      >
        <button
          type="button"
          aria-label="Change icon"
          className={cn(
            "flex w-fit items-center rounded-md transition-colors hover:bg-surface",
            page.icon
              ? "-ml-1 p-1 text-5xl leading-none"
              : "h-6 gap-1.5 px-1.5 text-xs text-muted-foreground",
          )}
        >
          {page.icon ?? (
            <>
              <PageIcon icon={null} className="size-3.5" />
              Add icon
            </>
          )}
        </button>
      </IconPicker>
      <input
        value={title}
        placeholder="Untitled"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (title !== page.title) updatePage(page.id, { title });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-full bg-transparent text-[2.25rem] font-semibold leading-tight tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

export function WorkspacePageView({ pageId }: { pageId: string }) {
  const router = useRouter();
  const ready = useWorkspaceStore((s) => s.ready);
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  const addBlock = useWorkspaceStore((s) => s.addBlock);
  const moveBlock = useWorkspaceStore((s) => s.moveBlock);
  const restorePage = useWorkspaceStore((s) => s.restorePage);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const page = pages[pageId];
  const locked = page?.locked ?? false;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (locked) setEditing(false);
  }, [locked]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || locked) return;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setPickerOpen(true);
      } else if (
        event.key.toLowerCase() === "e" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        setEditing((e) => !e);
      } else if (event.key === "Escape") {
        setEditing(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [locked]);

  if (!ready) return null;

  if (!page) {
    return (
      <Page>
        <PageHeader leading={<SidebarTrigger />} title="Not found" />
        <PageBody>
          <EmptyState label="This page doesn't exist" />
        </PageBody>
      </Page>
    );
  }

  if (page.deletedAt) {
    return (
      <Page>
        <PageHeader leading={<SidebarTrigger />} title={pageTitle(page)} />
        <PageBody>
          <EmptyState
            icon={<Trash2 />}
            label="In the trash"
            action={
              <Button variant="outline" onClick={() => restorePage(page.id)}>
                Restore
              </Button>
            }
          />
        </PageBody>
      </Page>
    );
  }

  const ancestors = pageAncestors(pages, page.id);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = page.blocks.findIndex((b) => b.id === active.id);
    const to = page.blocks.findIndex((b) => b.id === over.id);
    if (from >= 0 && to >= 0) moveBlock(page.id, from, to);
  };

  return (
    <Page>
      <PageHeader
        leading={<SidebarTrigger />}
        crumbs={ancestors.map((a) => ({
          label: (
            <span className="flex items-center gap-1.5">
              <PageIcon icon={a.icon} className="text-muted-foreground" />
              {pageTitle(a)}
            </span>
          ),
          onClick: () => router.push(pageHref(a.id)),
        }))}
        icon={<PageIcon icon={page.icon} />}
        title={pageTitle(page)}
      >
        {locked ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => updatePage(page.id, { locked: false })}
          >
            <Lock />
            Locked
          </Button>
        ) : (
          <Button
            variant={editing ? "default" : "ghost"}
            size="sm"
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? <Check /> : <Settings2 />}
            {editing ? "Done" : "Customize"}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Page options"
              className="text-muted-foreground"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuCheckboxItem
              checked={page.fullWidth}
              onCheckedChange={(fullWidth) =>
                updatePage(page.id, { fullWidth: fullWidth === true })
              }
            >
              Full width
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={page.locked}
              onCheckedChange={(value) =>
                updatePage(page.id, { locked: value === true })
              }
            >
              Lock layout
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <PageMenuItems pageId={page.id} />
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      <PageBody
        width={page.fullWidth ? "full" : "wide"}
        className="gap-10 pb-24"
      >
        <TitleArea page={page} />

        {page.blocks.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="ghost"
              className="-ml-3 text-muted-foreground"
              onClick={() => setPickerOpen(true)}
            >
              <Plus />
              Add a block
              <span className="ml-2 font-mono text-xs text-muted-foreground/70">
                /
              </span>
            </Button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={page.blocks.map((b) => b.id)}
              strategy={rectSortingStrategy}
            >
              <div className="@container">
                <div className="grid grid-cols-1 gap-x-10 gap-y-10 @3xl:grid-cols-6">
                  {page.blocks.map((block) => (
                    <BlockFrame
                      key={block.id}
                      block={block}
                      pageId={page.id}
                      editing={editing}
                    />
                  ))}
                </div>
              </div>
            </SortableContext>
          </DndContext>
        )}

        {page.blocks.length > 0 && !locked ? (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "-ml-2.5 self-start text-muted-foreground transition-opacity",
              !editing &&
                "opacity-0 hover:opacity-100 focus-visible:opacity-100",
            )}
            onClick={() => setPickerOpen(true)}
          >
            <Plus />
            Add a block
          </Button>
        ) : null}
      </PageBody>

      <BlockPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(type) => {
          addBlock(page.id, createBlock(type));
          setEditing(true);
        }}
      />
    </Page>
  );
}
