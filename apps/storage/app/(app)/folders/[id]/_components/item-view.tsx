"use client";

import { formatBytes, formatRelative, pluralize } from "@repo/cloud-ui/format";
import { Checkbox } from "@repo/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@repo/ui/context-menu";
import { cn } from "@repo/ui/utils";
import { Folder } from "lucide-react";
import { useState } from "react";
import { Thumbnail } from "@/components/thumbnail";
import { type Density, Tile, useCountdown } from "@/components/tile";
import { api } from "@/lib/api";
import { fileIcon, fileKind, kindColorClass } from "@/lib/file-kind";
import { keepClaimedFocus } from "@/lib/focus-claim";
import { InlineName } from "./inline-name";
import { ContextActions, ItemMenuButton, useItemActions } from "./item-actions";
import type { BrowserRow } from "./rows";
import type { BrowserController } from "./use-browser-controller";

export type { Density };

function useDropTarget(row: BrowserRow, controller: BrowserController) {
  const [dropOver, setDropOver] = useState(false);
  const handlers =
    row.type === "folder"
      ? {
          onDragLeave: () => setDropOver(false),
          onDragOver: (event: React.DragEvent) => {
            if (!controller.canDropInto(row.id)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropOver(true);
          },
          onDrop: (event: React.DragEvent) => {
            setDropOver(false);
            if (!controller.canDropInto(row.id)) return;
            event.preventDefault();
            event.stopPropagation();
            controller.onDropInto(row.id, event);
          },
        }
      : {};
  return { dropOver, handlers };
}

export function rowMeta(row: BrowserRow): string {
  if (row.type === "folder") {
    const count = row.childCount
      ? row.childCount.files + row.childCount.folders
      : null;
    return count === null
      ? "Folder"
      : count === 0
        ? "Empty"
        : pluralize(count, "item");
  }
  return `${formatBytes(row.sizeBytes ?? 0)} · ${formatRelative(row.updatedAt)}`;
}

export function rowIcon(row: Pick<BrowserRow, "type" | "name" | "mimeType">) {
  if (row.type === "folder") {
    return { Icon: Folder, color: kindColorClass("folder") };
  }
  return {
    Icon: fileIcon(row.name, row.mimeType),
    color: kindColorClass(fileKind(row.name, row.mimeType)),
  };
}

export function rowBadge(
  row: Pick<BrowserRow, "type" | "name" | "mimeType">,
): string | null {
  if (row.type === "folder") return null;
  const kind = fileKind(row.name, row.mimeType);
  if (kind === "video") return "Video";
  if (kind === "audio") return "Audio";
  if (kind === "pdf") return "PDF";
  return null;
}

function UndoInline({
  seconds,
  onUndo,
}: {
  seconds: number;
  onUndo: () => void;
}) {
  return (
    <span>
      Deleting in {seconds}s ·{" "}
      <button
        type="button"
        className="font-medium text-foreground underline-offset-2 hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          onUndo();
        }}
      >
        Undo
      </button>
    </span>
  );
}

export function ItemTile({
  row,
  controller,
  density,
  longPressHandlers,
}: {
  row: BrowserRow;
  controller: BrowserController;
  density: Density;
  longPressHandlers: (row: BrowserRow) => Record<string, unknown>;
}) {
  const { actions, dialog } = useItemActions(row, controller);
  const { dropOver, handlers } = useDropTarget(row, controller);
  const selected = controller.selection.has(row.id);
  const renaming = controller.renamingId === row.id;
  const { Icon, color } = rowIcon(row);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Tile
          data-row-id={row.id}
          draggable={!renaming && row.deleteAt === null}
          onDragStart={(event) => controller.onDragStart(row, event)}
          onDragEnd={controller.onDragEnd}
          onClick={(event) => controller.onRowClick(row, event)}
          // Radix does not stop the event, so without this the pane's own
          // context menu opens behind this one.
          onContextMenu={(event) => event.stopPropagation()}
          {...longPressHandlers(row)}
          {...handlers}
          name={row.name}
          meta={rowMeta(row)}
          icon={Icon}
          iconClassName={cn(color, row.type === "folder" && "fill-current")}
          thumbnailSrc={
            row.thumbnail && row.deleteAt === null
              ? api.url.thumbnail(row.id, 256, row.updatedAt)
              : null
          }
          badge={rowBadge(row)}
          density={density}
          selected={selected}
          focused={controller.focusedId === row.id}
          selectionMode={controller.selectionMode}
          pending={row.pending}
          deleteAt={row.deleteAt}
          onUndoDelete={() => controller.onUndoDelete(row.id)}
          onToggleSelect={() => controller.onToggleSelect(row)}
          className={cn(dropOver && "bg-muted/60 ring-2 ring-primary/60")}
          nameSlot={
            renaming ? (
              <InlineName
                className="w-full"
                initial={row.name}
                kind={row.type === "folder" ? "folder" : "file"}
                onCommit={(value) => controller.onCommitRename(row, value)}
                onCancel={controller.onCancelRename}
              />
            ) : undefined
          }
          menu={
            row.deleteAt === null ? (
              <ItemMenuButton row={row} actions={actions} />
            ) : undefined
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={keepClaimedFocus}>
        <ContextActions actions={actions} />
      </ContextMenuContent>
      {dialog}
    </ContextMenu>
  );
}

export function ItemRow({
  row,
  controller,
  density,
  longPressHandlers,
}: {
  row: BrowserRow;
  controller: BrowserController;
  density: Density;
  longPressHandlers: (row: BrowserRow) => Record<string, unknown>;
}) {
  const { actions, dialog } = useItemActions(row, controller);
  const { dropOver, handlers } = useDropTarget(row, controller);
  const selected = controller.selection.has(row.id);
  const focused = controller.focusedId === row.id;
  const renaming = controller.renamingId === row.id;
  const deleting = row.deleteAt !== null;
  const seconds = useCountdown(row.deleteAt);
  const { Icon, color } = rowIcon(row);
  const compact = density === "compact";
  const undo = () => controller.onUndoDelete(row.id);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr
          data-row-id={row.id}
          draggable={!renaming && !deleting}
          onDragStart={(event) => controller.onDragStart(row, event)}
          onDragEnd={controller.onDragEnd}
          onClick={(event) => controller.onRowClick(row, event)}
          onContextMenu={(event) => event.stopPropagation()}
          data-selected={selected}
          {...longPressHandlers(row)}
          {...handlers}
          className={cn(
            "select-none-drag group cursor-default border-b transition-colors duration-150 last:border-b-0",
            compact ? "h-9" : "h-11",
            selected ? "bg-muted/70" : "hover:bg-muted/40",
            focused && !selected && "ring-1 ring-inset ring-ring/50",
            dropOver && "ring-2 ring-inset ring-primary/60",
            (deleting || row.pending) && "opacity-50",
          )}
        >
          <td className="w-px pl-3 pr-2">
            <Checkbox
              checked={selected}
              aria-label={`Select ${row.name}`}
              className={cn(
                "transition-opacity",
                !selected &&
                  !controller.selectionMode &&
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => controller.onToggleSelect(row)}
            />
          </td>
          {/* w-full plus max-w-0 hands this cell every spare pixel while still
              giving `truncate` a width to work against. */}
          <td className="w-full max-w-0 pr-3">
            <div className="flex min-w-0 items-center gap-3">
              <Thumbnail
                src={
                  row.thumbnail && !deleting
                    ? api.url.thumbnail(row.id, 256, row.updatedAt)
                    : null
                }
                alt=""
                fallback={Icon}
                className={cn(
                  "shrink-0 rounded-md",
                  compact ? "size-6" : "size-7",
                )}
                iconClassName={cn(
                  compact ? "size-4" : "size-5",
                  color,
                  row.type === "folder" && "fill-current",
                )}
              />
              <div className="min-w-0 flex-1">
                {renaming ? (
                  <InlineName
                    initial={row.name}
                    kind={row.type === "folder" ? "folder" : "file"}
                    onCommit={(value) => controller.onCommitRename(row, value)}
                    onCancel={controller.onCancelRename}
                  />
                ) : (
                  <p className="truncate text-sm" title={row.name}>
                    {row.name}
                  </p>
                )}
                {!compact && !renaming && (
                  <p className="truncate text-xs text-muted-foreground lg:hidden">
                    {deleting ? (
                      <UndoInline seconds={seconds} onUndo={undo} />
                    ) : row.pending ? (
                      "Saving…"
                    ) : (
                      rowMeta(row)
                    )}
                  </p>
                )}
              </div>
            </div>
          </td>
          <td className="hidden whitespace-nowrap px-3 text-right text-sm tabular-nums text-muted-foreground lg:table-cell">
            {deleting ? (
              <UndoInline seconds={seconds} onUndo={undo} />
            ) : row.sizeBytes === null ? (
              rowMeta(row)
            ) : (
              formatBytes(row.sizeBytes)
            )}
          </td>
          <td className="hidden whitespace-nowrap px-3 text-right text-sm text-muted-foreground lg:table-cell">
            {formatRelative(row.updatedAt)}
          </td>
          <td className="w-px pr-2 text-right">
            {!deleting && (
              <ItemMenuButton
                row={row}
                actions={actions}
                className="bg-transparent shadow-none"
              />
            )}
          </td>
        </tr>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={keepClaimedFocus}>
        <ContextActions actions={actions} />
      </ContextMenuContent>
      {dialog}
    </ContextMenu>
  );
}
