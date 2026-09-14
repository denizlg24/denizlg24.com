"use client";

import { Button } from "@repo/ui/button";
import { ContextMenuItem, ContextMenuSeparator } from "@repo/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import { cn } from "@repo/ui/utils";
import type { LucideIcon } from "lucide-react";
import {
  Download,
  FolderInput,
  Link2,
  MoreHorizontal,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { Fragment, useState } from "react";
import { MovePicker } from "./move-picker";
import type { BrowserRow } from "./rows";
import { ShareSheet } from "./share-sheet";
import type { BrowserController } from "./use-browser-controller";

export interface ItemAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  /** Renders a divider above this entry. */
  separated?: boolean;
}

export interface ItemActionHandlers {
  onOpen: () => void;
  onDownload: () => void;
  onShare: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}

export function itemActions(
  row: BrowserRow,
  handlers: ItemActionHandlers,
  selectionCount: number,
): ItemAction[] {
  const many = selectionCount > 1;
  const actions: ItemAction[] = [
    {
      icon: SquareArrowOutUpRight,
      key: "open",
      label: row.type === "folder" ? "Open" : "Preview",
      onSelect: handlers.onOpen,
    },
    {
      icon: Download,
      key: "download",
      label: many
        ? `Download ${selectionCount} as ZIP`
        : row.type === "folder"
          ? "Download as ZIP"
          : "Download",
      onSelect: handlers.onDownload,
    },
  ];
  if (row.type === "file" && !many) {
    actions.push({
      icon: Link2,
      key: "share",
      label: "Share",
      onSelect: handlers.onShare,
    });
  }
  actions.push({
    icon: FolderInput,
    key: "move",
    label: many ? `Move ${selectionCount} items` : "Move to…",
    onSelect: handlers.onMove,
    separated: true,
  });
  if (!many) {
    actions.push({
      icon: Pencil,
      key: "rename",
      label: "Rename",
      onSelect: handlers.onRename,
    });
  }
  actions.push({
    destructive: true,
    icon: Trash2,
    key: "delete",
    label: many ? `Delete ${selectionCount} items` : "Delete",
    onSelect: handlers.onDelete,
    separated: true,
  });
  return actions;
}

type Panel = "share" | "move" | null;

/**
 * Share and Move are sheets, not popovers anchored inside a menu. The
 * previous popover fought Radix focus restoration on every open; a modal
 * dialog opened a tick after the menu closes has no such fight, and on a
 * phone it is a drawer.
 */
export function useItemActions(row: BrowserRow, controller: BrowserController) {
  const [panel, setPanel] = useState<Panel>(null);
  const scope = controller.scopeOf(row);
  const openPanel = (next: Exclude<Panel, null>) =>
    setTimeout(() => setPanel(next), 0);

  const actions = itemActions(
    row,
    {
      onDelete: () => controller.onDelete(scope),
      onDownload: () => controller.onDownload(scope),
      onMove: () => openPanel("move"),
      onOpen: () => controller.onOpen(row),
      onRename: () => controller.onStartRename(row.id),
      onShare: () => openPanel("share"),
    },
    scope.length,
  );

  const dialog = (
    <>
      <ResponsiveDialog
        open={panel === "share"}
        onOpenChange={(open) => !open && setPanel(null)}
        title={`Share “${row.name}”`}
        className="max-w-md"
      >
        {panel === "share" && (
          <ShareSheet fileId={row.id} filename={row.name} />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        open={panel === "move"}
        onOpenChange={(open) => !open && setPanel(null)}
        title={
          scope.length > 1 ? `Move ${scope.length} items` : `Move “${row.name}”`
        }
        className="max-w-md"
      >
        {panel === "move" && (
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
        )}
      </ResponsiveDialog>
    </>
  );

  return { actions, dialog };
}

export function ItemMenuButton({
  row,
  actions,
  className,
}: {
  row: BrowserRow;
  actions: ItemAction[];
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 rounded-full bg-background/90 shadow-sm",
            className,
          )}
          aria-label={`Actions for ${row.name}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
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
  );
}

export function DropdownActions({ actions }: { actions: ItemAction[] }) {
  return (
    <>
      {actions.map((action) => (
        // Fragments keep the items as direct children so Radix's roving focus
        // and typeahead still see them.
        <Fragment key={action.key}>
          {action.separated && <DropdownMenuSeparator />}
          <DropdownMenuItem
            variant={action.destructive ? "destructive" : "default"}
            onSelect={action.onSelect}
          >
            <action.icon className="size-4" />
            {action.label}
          </DropdownMenuItem>
        </Fragment>
      ))}
    </>
  );
}

export function ContextActions({ actions }: { actions: ItemAction[] }) {
  return (
    <>
      {actions.map((action) => (
        <Fragment key={action.key}>
          {action.separated && <ContextMenuSeparator />}
          <ContextMenuItem
            variant={action.destructive ? "destructive" : "default"}
            onSelect={action.onSelect}
          >
            <action.icon className="size-4" />
            {action.label}
          </ContextMenuItem>
        </Fragment>
      ))}
    </>
  );
}
