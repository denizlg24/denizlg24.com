"use client";

import { Button } from "@repo/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  HardDrive,
  Users,
} from "lucide-react";
import { useState } from "react";
import { pluralize } from "@/lib/format";
import { type SelectedEntry, useFolder, useRoots } from "@/lib/store";

function rootChoices(roots: ReturnType<typeof useRoots>) {
  if (!roots) return [];
  if ("projectRoot" in roots) {
    return [
      { icon: Folder, id: roots.projectRoot.id, label: roots.projectRoot.name },
    ];
  }
  return [
    { icon: HardDrive, id: roots.userRoot.id, label: "My files" },
    { icon: Users, id: roots.sharedRoot.id, label: "Shared" },
  ];
}

/** Browsable destination picker — no typing, no separate confirm dialog. */
export function MovePicker({
  entries,
  sourceFolderId,
  onMove,
  busy,
}: {
  entries: SelectedEntry[];
  sourceFolderId: string;
  onMove: (targetFolderId: string) => void;
  busy: boolean;
}) {
  const roots = useRoots();
  const choices = rootChoices(roots);
  const [folderId, setFolderId] = useState<string | null>(null);
  const state = useFolder(folderId);
  const movingIds = new Set(entries.map((entry) => entry.id));

  const label =
    folderId === null
      ? null
      : (choices.find((choice) => choice.id === folderId)?.label ??
        state.folder?.name ??
        "…");

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Move {pluralize(entries.length, "item")} to…
      </p>

      {folderId === null ? (
        <ul className="flex flex-col">
          {choices.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                onClick={() => setFolderId(choice.id)}
              >
                <choice.icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
          {choices.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              Loading folders…
            </li>
          )}
        </ul>
      ) : (
        <>
          <button
            type="button"
            className="flex items-center gap-1 self-start rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            onClick={() =>
              setFolderId(
                choices.some((choice) => choice.id === folderId)
                  ? null
                  : (state.folder?.parentId ?? null),
              )
            }
          >
            <ChevronLeft className="size-3" />
            Back
          </button>
          <p className="truncate px-1.5 text-sm font-medium">{label}</p>
          <ul className="scrollbar-thin flex max-h-48 flex-col overflow-y-auto">
            {state.loading && state.subfolders.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                Loading…
              </li>
            )}
            {!state.loading && state.subfolders.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                No folders inside.
              </li>
            )}
            {state.subfolders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  disabled={movingIds.has(folder.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-40"
                  onClick={() => setFolderId(folder.id)}
                >
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            disabled={busy || folderId === sourceFolderId}
            onClick={() => onMove(folderId)}
          >
            {folderId === sourceFolderId
              ? "Already here"
              : `Move here${label ? ` — ${label}` : ""}`}
          </Button>
        </>
      )}
    </div>
  );
}
