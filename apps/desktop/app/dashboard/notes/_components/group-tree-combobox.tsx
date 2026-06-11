"use client";

import { Check, ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { INoteGroup, IPersonGroup } from "@/lib/data-types";
import {
  buildChildrenByParent,
  buildGroupById,
  buildPathLabelMap,
  collectAncestorIds,
} from "@/lib/note-group-tree";

interface Props {
  groups: Array<INoteGroup | IPersonGroup>;
  value: string[];
  onChange: (next: string[]) => void;
  onCreateGroup?: (name: string) => Promise<INoteGroup | IPersonGroup | null>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function formatSelectionLabel(count: number, placeholder: string) {
  if (count <= 0) return placeholder;
  return `${count} group${count === 1 ? "" : "s"}`;
}

export function GroupTreeCombobox({
  groups,
  value,
  onChange,
  onCreateGroup,
  placeholder = "Add group…",
  searchPlaceholder = "Search groups…",
  emptyMessage = "No groups yet",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const groupById = useMemo(() => buildGroupById(groups), [groups]);
  const childrenByParent = useMemo(
    () => buildChildrenByParent(groups),
    [groups],
  );
  const pathLabelById = useMemo(() => buildPathLabelMap(groups), [groups]);

  useEffect(() => {
    const next = new Set<string>();
    for (const groupId of value) {
      for (const ancestorId of collectAncestorIds(groupId, groupById).slice(
        1,
      )) {
        next.add(ancestorId);
      }
    }
    setExpandedIds((current) => new Set([...current, ...next]));
  }, [groupById, value]);

  const normalizedQuery = query.trim().toLowerCase();

  const visibility = useMemo(() => {
    const visible = new Map<string, boolean>();

    const isVisible = (groupId: string): boolean => {
      const cached = visible.get(groupId);
      if (cached !== undefined) return cached;

      const pathLabel = pathLabelById.get(groupId)?.toLowerCase() ?? "";
      const selfMatches =
        normalizedQuery.length === 0 || pathLabel.includes(normalizedQuery);

      let descendantMatches = false;
      for (const child of childrenByParent.get(groupId) ?? []) {
        if (isVisible(child._id)) {
          descendantMatches = true;
        }
      }

      const next = selfMatches || descendantMatches;
      visible.set(groupId, next);
      return next;
    };

    for (const group of groups) {
      isVisible(group._id);
    }

    return visible;
  }, [childrenByParent, groups, normalizedQuery, pathLabelById]);

  const removeGroup = (groupId: string) => {
    onChange(value.filter((current) => current !== groupId));
  };

  const toggleGroup = (groupId: string) => {
    if (value.includes(groupId)) {
      removeGroup(groupId);
      return;
    }

    onChange(unique([...value, groupId]));
  };

  const toggleExpanded = (groupId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const createGroup = async () => {
    if (!onCreateGroup || creating) return;
    const name = query.trim();
    if (!name) return;

    setCreating(true);
    const group = await onCreateGroup(name);
    setCreating(false);
    if (!group) return;

    onChange(unique([...value, group._id]));
    setQuery("");
    setOpen(false);
  };

  const renderNode = (group: INoteGroup, depth: number): React.ReactNode => {
    if (!visibility.get(group._id)) return null;

    const children = (childrenByParent.get(group._id) ?? []).filter((child) =>
      visibility.get(child._id),
    );
    const hasChildren = children.length > 0;
    const expanded =
      normalizedQuery.length > 0 ? true : expandedIds.has(group._id);
    const selected = value.includes(group._id);

    return (
      <div key={group._id} className="min-w-0 overflow-hidden">
        <div
          className="flex min-w-0 items-center gap-1 pr-1"
          style={{ paddingLeft: `${Math.min(depth, 6) * 12}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpanded(group._id)}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${group.name}`}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => toggleGroup(group._id)}
            className={`flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent ${
              selected ? "bg-accent text-accent-foreground" : ""
            }`}
            title={pathLabelById.get(group._id) ?? group.name}
          >
            <span
              className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30"
              }`}
            >
              {selected && <Check className="size-3" />}
            </span>
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
          </button>
        </div>

        {expanded && hasChildren && (
          <div className="mt-0.5 min-w-0 overflow-hidden">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootGroups = (childrenByParent.get(null) ?? []).filter((group) =>
    visibility.get(group._id),
  );
  const triggerLabel = formatSelectionLabel(value.length, placeholder);
  const showCreate =
    Boolean(onCreateGroup) &&
    query.trim().length > 0 &&
    !groups.some(
      (group) => group.name.toLowerCase() === query.trim().toLowerCase(),
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="inline-flex w-fit min-w-0 max-w-[min(100%,24rem)] items-center gap-1 overflow-hidden align-middle">
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground"
            >
              <Plus className="size-2.5" />
              {triggerLabel}
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>

      <PopoverContent
        className="w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        align="start"
        sideOffset={6}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-3.5 shrink-0 opacity-50" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="flex h-9 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key === "Enter" && showCreate) {
                event.preventDefault();
                void createGroup();
              }
            }}
          />
        </div>

        <ScrollArea className="max-h-72 overflow-x-hidden">
          {groups.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </div>
          ) : rootGroups.length === 0 && !showCreate ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No groups found.
            </div>
          ) : (
            <div className="min-w-0 p-1">
              <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                {rootGroups.map((group) => renderNode(group, 0))}
              </div>
            </div>
          )}

          {showCreate && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => void createGroup()}
                disabled={creating}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                <Plus className="size-3" />
                {creating ? "Creating..." : `Create "${query.trim()}"`}
              </button>
            </div>
          )}
        </ScrollArea>

        {value.length > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs"
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
