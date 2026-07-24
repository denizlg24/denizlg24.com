"use client";

import { ContextMenuItem, ContextMenuSeparator } from "@repo/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import type { LucideIcon } from "lucide-react";
import {
  Download,
  FolderInput,
  Link2,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { Fragment } from "react";
import type { BrowserRow } from "./rows";

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
      label: "Get shareable link",
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
            <action.icon className="size-3.5" />
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
            <action.icon className="size-3.5" />
            {action.label}
          </ContextMenuItem>
        </Fragment>
      ))}
    </>
  );
}
