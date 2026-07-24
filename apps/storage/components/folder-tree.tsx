"use client";

import type { RootFolders } from "@repo/schemas/cloud";
import { cn } from "@repo/ui/utils";
import { ChevronRight, FolderOpen, HardDrive, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { activeDrag, endDrag, readDrop } from "@/lib/drag";
import { pluralize } from "@/lib/format";
import { store, useFolder, useRoots } from "@/lib/store";

interface NodeProps {
  id: string;
  name: string;
  depth: number;
  currentFolderId: string | null;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onNavigate: () => void;
}

function useDropTarget(folderId: string) {
  const [over, setOver] = useState(false);

  const canAccept = (): boolean => {
    const drag = activeDrag();
    if (!drag) return false;
    if (drag.sourceFolderId === folderId) return false;
    return !drag.entries.some((entry) => entry.id === folderId);
  };

  return {
    over,
    handlers: {
      onDragLeave: () => setOver(false),
      onDragOver: (event: React.DragEvent) => {
        if (!canAccept()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDrop: async (event: React.DragEvent) => {
        setOver(false);
        const payload = readDrop(event.dataTransfer);
        endDrag();
        if (!payload || payload.sourceFolderId === folderId) return;
        event.preventDefault();
        event.stopPropagation();
        const result = await store.move(
          payload.entries,
          payload.sourceFolderId,
          folderId,
        );
        if (result.failures.length > 0) {
          toast.error(
            `Couldn't move ${pluralize(result.failures.length, "item")}`,
            { description: result.failures[0]?.message },
          );
        } else if (result.moved > 0) {
          toast.success(`Moved ${pluralize(result.moved, "item")}`);
        }
      },
    },
  };
}

function TreeNode({
  id,
  name,
  depth,
  currentFolderId,
  expanded,
  toggle,
  onNavigate,
}: NodeProps) {
  const router = useRouter();
  const isExpanded = expanded.has(id);
  const isCurrent = currentFolderId === id;
  const { over, handlers } = useDropTarget(id);

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 rounded pr-1 text-sm transition-colors",
          isCurrent ? "bg-muted font-medium" : "hover:bg-muted/60",
          over && "ring-1 ring-inset ring-foreground/40",
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
        {...handlers}
      >
        <button
          type="button"
          aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => toggle(id)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate py-1.5 text-left"
          onClick={() => {
            router.push(`/folders/${id}`);
            onNavigate();
          }}
          title={name}
        >
          {name}
        </button>
      </div>
      {isExpanded && (
        <TreeChildren
          id={id}
          depth={depth + 1}
          currentFolderId={currentFolderId}
          expanded={expanded}
          toggle={toggle}
          onNavigate={onNavigate}
        />
      )}
    </>
  );
}

function TreeChildren({
  id,
  depth,
  currentFolderId,
  expanded,
  toggle,
  onNavigate,
}: Omit<NodeProps, "name">) {
  const state = useFolder(id);

  if (state.loading && state.subfolders.length === 0) {
    return (
      <p
        className="py-1 text-xs text-muted-foreground"
        style={{ paddingLeft: `${depth * 12 + 24}px` }}
      >
        Loading…
      </p>
    );
  }
  if (state.subfolders.length === 0) {
    return (
      <p
        className="py-1 text-xs text-muted-foreground"
        style={{ paddingLeft: `${depth * 12 + 24}px` }}
      >
        No folders
      </p>
    );
  }
  return (
    <>
      {state.subfolders.map((folder) => (
        <TreeNode
          key={folder.id}
          id={folder.id}
          name={folder.name}
          depth={depth}
          currentFolderId={currentFolderId}
          expanded={expanded}
          toggle={toggle}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

function RootRow({
  id,
  label,
  icon: Icon,
  currentFolderId,
  expanded,
  toggle,
  onNavigate,
}: {
  id: string;
  label: string;
  icon: typeof HardDrive;
  currentFolderId: string | null;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const isExpanded = expanded.has(id);
  const { over, handlers } = useDropTarget(id);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded text-sm transition-colors",
          currentFolderId === id ? "bg-muted font-medium" : "hover:bg-muted/60",
          over && "ring-1 ring-inset ring-foreground/40",
        )}
        {...handlers}
      >
        <button
          type="button"
          aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => toggle(id)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          onClick={() => {
            router.push(`/folders/${id}`);
            onNavigate();
          }}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </button>
      </div>
      {isExpanded && (
        <TreeChildren
          id={id}
          depth={1}
          currentFolderId={currentFolderId}
          expanded={expanded}
          toggle={toggle}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

function rootRows(roots: RootFolders) {
  if ("projectRoot" in roots) {
    return [
      {
        icon: FolderOpen,
        id: roots.projectRoot.id,
        label: roots.projectRoot.name,
      },
    ];
  }
  return [
    { icon: HardDrive, id: roots.userRoot.id, label: "My files" },
    { icon: Users, id: roots.sharedRoot.id, label: "Shared" },
  ];
}

export function FolderTree({
  currentFolderId,
  onNavigate = () => undefined,
}: {
  currentFolderId: string | null;
  onNavigate?: () => void;
}) {
  const roots = useRoots();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!roots) {
    return (
      <div className="space-y-2 p-2">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-5 w-20 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Folders">
      {rootRows(roots).map((root) => (
        <RootRow
          key={root.id}
          id={root.id}
          label={root.label}
          icon={root.icon}
          currentFolderId={currentFolderId}
          expanded={expanded}
          toggle={toggle}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
