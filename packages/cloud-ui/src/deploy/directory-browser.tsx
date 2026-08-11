"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Spinner } from "@repo/ui/spinner";
import { ChevronRight, Folder } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../api-error";
import { deployApi } from "./api";

interface Entry {
  path: string;
  name: string;
  type: "file" | "dir";
}

/**
 * Children keyed by parent path, so a directory opened twice is fetched once
 * and collapsing does not throw away what it cost a request to learn.
 */
type Children = Map<string, Entry[]>;

/**
 * The repository tree, expandable in place.
 *
 * Levels are fetched as they are opened rather than up front: the Contents API
 * is a request per directory either way, and a recursive listing of a large
 * repository is megabytes to answer "which of these four apps". Files are
 * listed but not selectable — the root directory is a directory, and hiding
 * them entirely makes a correct tree look empty.
 */
function TreeNode({
  entry,
  depth,
  selected,
  tree,
  loading,
  expanded,
  onToggle,
  onSelect,
}: {
  entry: Entry;
  depth: number;
  selected: string;
  tree: Children;
  loading: Set<string>;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isOpen = expanded.has(entry.path);
  const loaded = tree.get(entry.path);
  const isSelected = selected === entry.path;

  return (
    <>
      <div
        className={`flex items-center gap-1 rounded-sm ${
          isSelected ? "bg-muted" : "hover:bg-muted/40"
        }`}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <button
          type="button"
          aria-label={
            isOpen ? `Collapse ${entry.name}` : `Expand ${entry.name}`
          }
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={() => onToggle(entry.path)}
        >
          {loading.has(entry.path) ? (
            <Spinner className="size-3" />
          ) : (
            <ChevronRight
              className={`size-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          )}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left font-mono text-xs"
          onClick={() => onSelect(entry.path)}
        >
          <Folder className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.name}</span>
        </button>
      </div>
      {isOpen &&
        (loaded ?? [])
          .filter((child) => child.type === "dir")
          .map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selected={selected}
              tree={tree}
              loading={loading}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
      {isOpen &&
        loaded !== undefined &&
        loaded.filter((child) => child.type === "dir").length === 0 && (
          <p
            className="py-1 text-xs text-muted-foreground"
            style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}
          >
            no subdirectories
          </p>
        )}
    </>
  );
}

export function RootDirectoryDialog({
  open,
  onOpenChange,
  owner,
  repo,
  gitRef,
  value,
  workspaces,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  gitRef: string;
  value: string;
  workspaces: { path: string; name: string }[];
  onChange: (path: string) => void;
}) {
  const [children, setChildren] = useState<Children>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (path: string) => {
      setLoading((current) => new Set(current).add(path));
      setError(null);
      try {
        const entries = await deployApi.github.tree(owner, repo, {
          ref: gitRef,
          path,
        });
        setChildren((current) => new Map(current).set(path, entries));
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [owner, repo, gitRef],
  );

  // Reopening starts from the value the form holds, not from wherever the last
  // visit was left — a dialog that reopens on a stale selection is how the
  // wrong directory gets confirmed.
  useEffect(() => {
    if (!open) return;
    setSelected(value);
    // Every ancestor of the current value is opened, so the selection is on
    // screen instead of collapsed three levels down.
    const segments = value.split("/").filter(Boolean);
    setExpanded(
      new Set(
        segments.map((_, index) => segments.slice(0, index + 1).join("/")),
      ),
    );
    void load("");
    for (const [index] of segments.entries()) {
      void load(segments.slice(0, index + 1).join("/"));
    }
  }, [open, value, load]);

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!children.has(path)) void load(path);
      }
      return next;
    });
  }

  const roots = (children.get("") ?? []).filter(
    (entry) => entry.type === "dir",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Root directory</DialogTitle>
        </DialogHeader>

        {/* {workspaces.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {workspaces.map((workspace) => (
              <button
                key={workspace.path}
                type="button"
                onClick={() => setSelected(workspace.path)}
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-xs ${
                  selected === workspace.path
                    ? "border-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {workspace.path}
              </button>
            ))}
          </div>
        )} */}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex max-h-80 flex-col overflow-y-auto rounded-md border p-1">
          <button
            type="button"
            onClick={() => setSelected("")}
            className={`flex items-center gap-1.5 rounded-sm px-1 py-1 pl-6 text-left font-mono text-xs ${
              selected === "" ? "bg-muted" : "hover:bg-muted/40"
            }`}
          >
            <Folder className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{repo}</span>
          </button>
          {roots.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={1}
              selected={selected}
              tree={children}
              loading={loading}
              expanded={expanded}
              onToggle={toggle}
              onSelect={setSelected}
            />
          ))}
          {loading.has("") && roots.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">loading…</p>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs">
              {selected || "./"}
            </span>
            {workspaces.some((workspace) => workspace.path === selected) && (
              <Badge variant="secondary">workspace</Badge>
            )}
          </span>
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onChange(selected);
                onOpenChange(false);
              }}
            >
              Select
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
