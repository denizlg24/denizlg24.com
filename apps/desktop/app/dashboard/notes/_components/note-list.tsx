"use client";

import { ExternalLink, FileText, Globe } from "lucide-react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { INote, INoteGroup } from "@/lib/data-types";

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function excerptFromNote(note: INote) {
  const source = note.description?.trim() || note.content.trim();
  const normalized = source
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return note.url ? safeHostname(note.url) : "Empty note";
  }

  return normalized.length > 180
    ? `${normalized.slice(0, 180).trim()}…`
    : normalized;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Props {
  notes: INote[];
  groups: INoteGroup[];
  onSelect: (note: INote) => void;
  onSelectGroup: (group: INoteGroup) => void;
}

export function NoteList({ notes, groups, onSelect, onSelectGroup }: Props) {
  const groupMap = new Map(groups.map((group) => [group._id, group]));

  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No notes match the current filters.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="min-w-195">
        <div className="grid grid-cols-[1.5rem_minmax(0,2.2fr)_minmax(0,1.7fr)_minmax(0,1.3fr)_minmax(0,1fr)_6.5rem] gap-3 border-b px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span />
          <span>Title</span>
          <span>Excerpt</span>
          <span>Groups</span>
          <span>Tags</span>
          <span className="text-right">Updated</span>
        </div>

        <div className="divide-y">
          {notes.map((note) => {
            const noteGroups = (note.groupIds ?? [])
              .map((groupId) => groupMap.get(groupId))
              .filter((group): group is INoteGroup => Boolean(group));

            return (
              <div
                role="button"
                tabIndex={0}
                key={note._id}
                onClick={() => onSelect(note)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(note);
                  }
                }}
                className="grid w-full cursor-pointer grid-cols-[1.5rem_minmax(0,2.2fr)_minmax(0,1.7fr)_minmax(0,1.3fr)_minmax(0,1fr)_6.5rem] gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="pt-0.5">
                  {note.favicon ? (
                    <Image
                      src={note.favicon}
                      alt=""
                      width={16}
                      height={16}
                      className="size-4 rounded-sm"
                      unoptimized
                    />
                  ) : note.url ? (
                    <Globe className="size-4 text-muted-foreground" />
                  ) : (
                    <FileText className="size-4 text-muted-foreground" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {note.title}
                    </span>
                    {note.url && (
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    {note.status === "archived" && (
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-[10px]"
                      >
                        archived
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{note.url ? "Linked note" : "Markdown note"}</span>
                    {note.url && (
                      <span className="truncate">{safeHostname(note.url)}</span>
                    )}
                  </div>
                </div>

                <p className="line-clamp-3 text-xs text-muted-foreground">
                  {excerptFromNote(note)}
                </p>

                <div className="flex flex-wrap content-start gap-1">
                  {noteGroups.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">
                      None
                    </span>
                  ) : (
                    noteGroups.map((group) => (
                      <button
                        key={group._id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectGroup(group);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        className="inline-flex"
                      >
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px] hover:bg-accent"
                        >
                          {group.name}
                        </Badge>
                      </button>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap content-start gap-1">
                  {(note.tags ?? []).length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">
                      None
                    </span>
                  ) : (
                    (note.tags ?? []).map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="h-4 px-1.5 text-[10px]"
                      >
                        {tag}
                      </Badge>
                    ))
                  )}
                </div>

                <div className="text-right text-[11px] text-muted-foreground">
                  {formatDate(note.updatedAt)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
