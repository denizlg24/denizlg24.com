"use client";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@repo/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@repo/ui/popover";
import { cn } from "@repo/ui/utils";
import { Folder, MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { fileIcon } from "@/lib/file-kind";
import { formatBytes, formatRelative } from "@/lib/format";
import { InlineName } from "./inline-name";
import { ContextActions, DropdownActions, itemActions } from "./item-menu";
import { MovePicker } from "./move-picker";
import type { BrowserRow } from "./rows";
import { SharePanel } from "./share-panel";

export type Density = "comfortable" | "compact";

export interface BrowserController {
  folderId: string;
  selection: Set<string>;
  focusedId: string | null;
  renamingId: string | null;
  moving: boolean;
  onPointerSelect: (row: BrowserRow, event: React.MouseEvent) => void;
  onToggleSelect: (row: BrowserRow) => void;
  onOpen: (row: BrowserRow) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (row: BrowserRow, name: string) => void;
  onCancelRename: () => void;
  onDelete: (rows: BrowserRow[]) => void;
  onMove: (rows: BrowserRow[], targetFolderId: string) => void;
  onDownload: (rows: BrowserRow[]) => void;
  onDragStart: (row: BrowserRow, event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDropInto: (folderId: string, event: React.DragEvent) => void;
  canDropInto: (folderId: string) => boolean;
  /** The row plus the rest of the selection when the row is part of it. */
  scopeOf: (row: BrowserRow) => BrowserRow[];
}

type Panel = "share" | "move" | null;

function useItem(row: BrowserRow, controller: BrowserController) {
  const [panel, setPanel] = useState<Panel>(null);
  const [dropOver, setDropOver] = useState(false);
  const scope = controller.scopeOf(row);

  const actions = itemActions(
    row,
    {
      onDelete: () => controller.onDelete(scope),
      onDownload: () => controller.onDownload(scope),
      onMove: () => setPanel("move"),
      onOpen: () => controller.onOpen(row),
      onRename: () => controller.onStartRename(row.id),
      onShare: () => setPanel("share"),
    },
    scope.length,
  );

  const dropHandlers =
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

  const panelContent =
    panel === "share" ? (
      <SharePanel fileId={row.id} filename={row.name} />
    ) : panel === "move" ? (
      <MovePicker
        entries={scope.map((entry) => ({
          id: entry.id,
          name: entry.name,
          type: entry.type,
        }))}
        sourceFolderId={controller.folderId}
        busy={controller.moving}
        onMove={(targetFolderId) => {
          setPanel(null);
          controller.onMove(scope, targetFolderId);
        }}
      />
    ) : null;

  return { actions, dropHandlers, dropOver, panel, panelContent, setPanel };
}

function Menu({
  row,
  actions,
  panel,
  panelContent,
  setPanel,
  className,
}: {
  row: BrowserRow;
  actions: ReturnType<typeof itemActions>;
  panel: Panel;
  panelContent: ReactNode;
  setPanel: (panel: Panel) => void;
  className?: string;
}) {
  return (
    <Popover
      open={panel !== null}
      onOpenChange={(open) => !open && setPanel(null)}
    >
      <PopoverAnchor className={cn("flex items-center", className)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Actions for ${row.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownActions actions={actions} />
          </DropdownMenuContent>
        </DropdownMenu>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className={panel === "share" ? "w-80" : "w-72"}
        onClick={(event) => event.stopPropagation()}
      >
        {panelContent}
      </PopoverContent>
    </Popover>
  );
}

export function ItemRow({
  row,
  controller,
  density,
}: {
  row: BrowserRow;
  controller: BrowserController;
  density: Density;
}) {
  const { actions, dropHandlers, dropOver, panel, panelContent, setPanel } =
    useItem(row, controller);
  const selected = controller.selection.has(row.id);
  const focused = controller.focusedId === row.id;
  const renaming = controller.renamingId === row.id;
  const Icon =
    row.type === "folder" ? Folder : fileIcon(row.name, row.mimeType);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr
          data-row-id={row.id}
          draggable={!renaming}
          onDragStart={(event) => controller.onDragStart(row, event)}
          onDragEnd={controller.onDragEnd}
          onClick={(event) => controller.onPointerSelect(row, event)}
          onDoubleClick={() => controller.onOpen(row)}
          className={cn(
            "select-none-drag cursor-default border-b transition-colors last:border-b-0",
            selected ? "bg-muted/70" : "hover:bg-muted/40",
            focused && "ring-1 ring-inset ring-ring/60",
            dropOver && "ring-1 ring-inset ring-foreground/50",
          )}
          {...dropHandlers}
        >
          <td
            className={cn(
              "w-px pl-3 pr-2",
              density === "compact" ? "py-1" : "py-2",
            )}
          >
            <Checkbox
              checked={selected}
              aria-label={`Select ${row.name}`}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => controller.onToggleSelect(row)}
            />
          </td>
          {/* w-full plus max-w-0 hands this cell every spare pixel while still
              giving `truncate` a width to work against. */}
          <td
            className={cn(
              "w-full max-w-0 pr-3",
              density === "compact" ? "py-1" : "py-2",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              {renaming ? (
                <InlineName
                  initial={row.name}
                  kind={row.type === "folder" ? "folder" : "file"}
                  onCommit={(value) => controller.onCommitRename(row, value)}
                  onCancel={controller.onCancelRename}
                />
              ) : (
                <span className="truncate text-sm" title={row.name}>
                  {row.name}
                </span>
              )}
            </div>
          </td>
          <td className="hidden whitespace-nowrap px-3 text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
            {row.sizeBytes === null ? "—" : formatBytes(row.sizeBytes)}
          </td>
          <td className="hidden whitespace-nowrap px-3 text-right text-xs text-muted-foreground md:table-cell">
            {formatRelative(row.updatedAt)}
          </td>
          <td className="hidden whitespace-nowrap px-3 text-right text-[10px] uppercase tracking-wide text-muted-foreground lg:table-cell">
            {row.tier ?? ""}
          </td>
          <td className="w-px pr-2 text-right">
            <Menu
              row={row}
              actions={actions}
              panel={panel}
              panelContent={panelContent}
              setPanel={setPanel}
              className="justify-end"
            />
          </td>
        </tr>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextActions actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ItemTile({
  row,
  controller,
  density,
}: {
  row: BrowserRow;
  controller: BrowserController;
  density: Density;
}) {
  const { actions, dropHandlers, dropOver, panel, panelContent, setPanel } =
    useItem(row, controller);
  const selected = controller.selection.has(row.id);
  const focused = controller.focusedId === row.id;
  const renaming = controller.renamingId === row.id;
  const Icon =
    row.type === "folder" ? Folder : fileIcon(row.name, row.mimeType);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          data-row-id={row.id}
          draggable={!renaming}
          onDragStart={(event) => controller.onDragStart(row, event)}
          onDragEnd={controller.onDragEnd}
          onClick={(event) => controller.onPointerSelect(row, event)}
          onDoubleClick={() => controller.onOpen(row)}
          className={cn(
            "select-none-drag group relative flex cursor-default flex-col items-center gap-2 rounded-lg border p-3 transition-colors",
            density === "compact" ? "p-2" : "p-3",
            selected
              ? "border-foreground/30 bg-muted/70"
              : "border-transparent hover:bg-muted/40",
            focused && "ring-1 ring-ring/60",
            dropOver && "ring-1 ring-foreground/50",
          )}
          {...dropHandlers}
        >
          <div
            className="absolute left-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 data-[selected=true]:opacity-100"
            data-selected={selected}
          >
            <Checkbox
              checked={selected}
              aria-label={`Select ${row.name}`}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => controller.onToggleSelect(row)}
            />
          </div>
          <div className="absolute right-0.5 top-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Menu
              row={row}
              actions={actions}
              panel={panel}
              panelContent={panelContent}
              setPanel={setPanel}
            />
          </div>
          <Icon
            className={cn(
              "shrink-0 text-muted-foreground",
              density === "compact" ? "mt-3 size-7" : "mt-4 size-9",
            )}
            strokeWidth={1.25}
          />
          {renaming ? (
            <InlineName
              className="w-full"
              initial={row.name}
              kind={row.type === "folder" ? "folder" : "file"}
              onCommit={(value) => controller.onCommitRename(row, value)}
              onCancel={controller.onCancelRename}
            />
          ) : (
            <span
              className="line-clamp-2 w-full break-all text-center text-xs"
              title={row.name}
            >
              {row.name}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {row.sizeBytes === null ? "Folder" : formatBytes(row.sizeBytes)}
          </span>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextActions actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
