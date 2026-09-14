"use client";

import { pluralize } from "@repo/cloud-ui/format";
import { Button } from "@repo/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  HardDrive,
  Users,
} from "lucide-react";
import { useState } from "react";
import { type DeletableEntry, useChildren, useRoots } from "@/lib/queries";

function rootChoices(roots: ReturnType<typeof useRoots>) {
  if (!roots) return [];
  if ("projectRoot" in roots) {
    return [
      { icon: Folder, id: roots.projectRoot.id, label: roots.projectRoot.name },
    ];
  }
  return [
    { icon: HardDrive, id: roots.userRoot.id, label: "My files" },
    { icon: Users, id: roots.sharedRoot.id, label: "Family" },
  ];
}

/**
 * Browsable destination picker — no typing, no separate confirm dialog.
 *
 * Keeps its own trail of the folders descended into, so stepping back needs
 * no listing of the parent: the subfolder query carries names only.
 */
export function MovePicker({
  entries,
  sourceFolderId,
  onMove,
  busy,
}: {
  entries: DeletableEntry[];
  sourceFolderId: string;
  onMove: (targetFolderId: string) => void;
  busy: boolean;
}) {
  const roots = useRoots();
  const choices = rootChoices(roots);
  const [trail, setTrail] = useState<{ id: string; label: string }[]>([]);
  const current = trail[trail.length - 1] ?? null;
  const { children, loading } = useChildren(current?.id ?? null);
  const movingIds = new Set(entries.map((entry) => entry.id));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Move {pluralize(entries.length, "item")} to…
      </p>

      {current === null ? (
        <ul className="flex flex-col">
          {choices.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted/60"
                onClick={() =>
                  setTrail([{ id: choice.id, label: choice.label }])
                }
              >
                <choice.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
          {choices.length === 0 && (
            <li className="px-2 py-2 text-sm text-muted-foreground">
              Loading folders…
            </li>
          )}
        </ul>
      ) : (
        <>
          <button
            type="button"
            className="flex items-center gap-1 self-start rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            onClick={() => setTrail((stack) => stack.slice(0, -1))}
          >
            <ChevronLeft className="size-3.5" />
            Back
          </button>
          <p className="truncate px-1.5 text-sm font-medium">{current.label}</p>
          <ul className="scrollbar-thin flex max-h-56 flex-col overflow-y-auto">
            {loading && children.length === 0 && (
              <li className="px-2 py-2 text-sm text-muted-foreground">
                Loading…
              </li>
            )}
            {!loading && children.length === 0 && (
              <li className="px-2 py-2 text-sm text-muted-foreground">
                No folders inside.
              </li>
            )}
            {children.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  disabled={movingIds.has(folder.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-40"
                  onClick={() =>
                    setTrail((stack) => [
                      ...stack,
                      { id: folder.id, label: folder.name },
                    ])
                  }
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            disabled={busy || current.id === sourceFolderId}
            onClick={() => onMove(current.id)}
          >
            {current.id === sourceFolderId
              ? "Already here"
              : `Move here — ${current.label}`}
          </Button>
        </>
      )}
    </div>
  );
}
