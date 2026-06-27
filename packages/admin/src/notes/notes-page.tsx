"use client";

import type { INote, INoteEdge, INoteGraph, INoteGroup } from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Textarea } from "@repo/ui/textarea";
import {
  FilePlus2,
  FileText,
  FolderPlus,
  FolderTree,
  Link2,
  Loader2,
  RefreshCcw,
  Search,
  Tags,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { GroupDetail } from "./group-detail";
import { buildDescendantIdMap, buildPathLabelMap } from "./group-tree";
import { GroupTreeCombobox } from "./group-tree-combobox";
import { NoteDetail } from "./note-detail";
import { NoteFolderView } from "./note-folder-view";
import { TagAutocomplete } from "./tag-autocomplete";

type Sort =
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc"
  | "title-asc"
  | "title-desc";
type HasUrlFilter = "all" | "with-url" | "without-url";
type StatusFilter = "all" | INote["status"];

function sortNotes(notes: INote[], sort: Sort) {
  const items = [...notes];

  items.sort((left, right) => {
    switch (sort) {
      case "updated-asc":
        return (
          new Date(left.updatedAt).getTime() -
          new Date(right.updatedAt).getTime()
        );
      case "created-desc":
        return (
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
        );
      case "created-asc":
        return (
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime()
        );
      case "title-asc":
        return left.title.localeCompare(right.title);
      case "title-desc":
        return right.title.localeCompare(left.title);
      default:
        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
    }
  });

  return items;
}

function matchesQuery(note: INote, query: string, groupSearchLabels: string[]) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [
    note.title,
    note.content,
    note.url,
    note.description,
    note.siteName,
    note.class,
    ...groupSearchLabels,
    ...(note.tags ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function NotesSkeleton() {
  const { slots } = useAdmin();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 items-center gap-2 border-b px-3 py-2 sm:px-4">
        {slots?.sidebarTrigger}
        <FileText className="size-4" />
        <span className="text-sm font-medium">Notes</span>
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Skeleton className="h-8 w-full sm:w-72" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

export function NotesPage() {
  const { client, slots } = useAdmin();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notes, setNotes] = useState<INote[]>([]);
  const [groups, setGroups] = useState<INoteGroup[]>([]);
  const [edges, setEdges] = useState<INoteEdge[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [folderCurrentId, setFolderCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedGroupFilters, setSelectedGroupFilters] = useState<string[]>(
    [],
  );
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [hasUrlFilter, setHasUrlFilter] = useState<HasUrlFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("updated-desc");
  const [newNoteParentId, setNewNoteParentId] = useState<
    string | null | undefined
  >(undefined);
  const [newGroupParentId, setNewGroupParentId] = useState<
    string | null | undefined
  >(undefined);
  const [pendingDeleteNote, setPendingDeleteNote] = useState<INote | null>(
    null,
  );
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    useState<INoteGroup | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const [graphResult, tagsResult] = await Promise.all([
          client.get<INoteGraph>("notes"),
          client.get<{ tags: string[] }>("notes/tags"),
        ]);
        setNotes(graphResult.notes);
        setGroups(graphResult.groups);
        setEdges(graphResult.edges);
        setTagSuggestions(tagsResult.tags);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load notes"));
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const noteId = new URLSearchParams(window.location.search).get("note");
    if (!noteId || notes.length === 0) return;

    const note = notes.find((candidate) => candidate._id === noteId);
    if (note) {
      setSelectedGroupId(null);
      setSelectedId(note._id);
    }
  }, [notes]);

  useEffect(() => {
    if (selectedId && !notes.some((note) => note._id === selectedId)) {
      setSelectedId(null);
    }
  }, [notes, selectedId]);

  useEffect(() => {
    if (
      selectedGroupId &&
      !groups.some((group) => group._id === selectedGroupId)
    ) {
      setSelectedGroupId(null);
    }
  }, [groups, selectedGroupId]);

  const allTags = useMemo(
    () =>
      [
        ...new Set([
          ...tagSuggestions,
          ...notes.flatMap((note) => note.tags ?? []),
        ]),
      ].sort((left, right) => left.localeCompare(right)),
    [notes, tagSuggestions],
  );
  const pathLabelById = useMemo(() => buildPathLabelMap(groups), [groups]);
  const descendantIdsByGroup = useMemo(
    () => buildDescendantIdMap(groups),
    [groups],
  );
  const selectedGroupScope = useMemo(() => {
    const next = new Set<string>();

    for (const groupId of selectedGroupFilters) {
      for (const scopedId of descendantIdsByGroup.get(groupId) ?? [groupId]) {
        next.add(scopedId);
      }
    }

    return next;
  }, [descendantIdsByGroup, selectedGroupFilters]);

  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      const groupSearchLabels = (note.groupIds ?? [])
        .map((groupId) => pathLabelById.get(groupId))
        .filter((label): label is string => Boolean(label));

      if (!matchesQuery(note, query, groupSearchLabels)) return false;
      if (statusFilter !== "all" && note.status !== statusFilter) return false;
      if (hasUrlFilter === "with-url" && !note.url) return false;
      if (hasUrlFilter === "without-url" && note.url) return false;

      if (
        selectedGroupScope.size > 0 &&
        !(note.groupIds ?? []).some((groupId) =>
          selectedGroupScope.has(groupId),
        )
      ) {
        return false;
      }

      if (
        selectedTagFilters.length > 0 &&
        !selectedTagFilters.every((tag) => (note.tags ?? []).includes(tag))
      ) {
        return false;
      }

      return true;
    });
  }, [
    hasUrlFilter,
    notes,
    pathLabelById,
    query,
    selectedGroupScope,
    selectedTagFilters,
    statusFilter,
  ]);

  const sortedNotes = useMemo(
    () => sortNotes(filteredNotes, sort),
    [filteredNotes, sort],
  );

  const selectedNote = useMemo(
    () => notes.find((note) => note._id === selectedId) ?? null,
    [notes, selectedId],
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group._id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const hasActiveFilters =
    query.trim().length > 0 ||
    selectedGroupFilters.length > 0 ||
    selectedTagFilters.length > 0 ||
    hasUrlFilter !== "all" ||
    statusFilter !== "all" ||
    sort !== "updated-desc";

  const applyUpdatedNote = useCallback((next: INote) => {
    setNotes((current) =>
      current.some((note) => note._id === next._id)
        ? current.map((note) => (note._id === next._id ? next : note))
        : [next, ...current],
    );
    setSelectedGroupId(null);
    setSelectedId(next._id);
  }, []);

  const handlePatchNote = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      try {
        const result = await client.patch<{ note: INote }>(`notes/${id}`, body);
        applyUpdatedNote(result.note);
        return result.note;
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to update note"));
        return null;
      }
    },
    [applyUpdatedNote, client],
  );

  const handleDeleteNote = useCallback(
    async (id: string) => {
      try {
        await client.del<{ success: true }>(`notes/${id}`);
        setNotes((current) => current.filter((note) => note._id !== id));
        setEdges((current) =>
          current.filter((edge) => edge.from !== id && edge.to !== id),
        );
        if (selectedId === id) setSelectedId(null);
        toast.success("Note deleted");
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to delete note"));
      }
    },
    [client, selectedId],
  );

  const handleCreateNote = useCallback(
    async (input: {
      title: string;
      url: string;
      content: string;
      groupIds: string[];
    }) => {
      const title = input.title.trim();
      const url = input.url.trim();
      const content = input.content;

      if (!title && !url) {
        toast.error("Title or URL is required");
        return false;
      }

      try {
        const result = await client.post<{
          note: INote;
          groups: INoteGroup[];
          edges: INoteEdge[];
        }>("notes", {
          title: title || undefined,
          url: url || undefined,
          content,
          groupIds: input.groupIds,
          skipCategorize: true,
        });
        applyUpdatedNote(result.note);
        setGroups(result.groups ?? groups);
        setEdges((current) => [
          ...current.filter(
            (edge) =>
              edge.from !== result.note._id && edge.to !== result.note._id,
          ),
          ...(result.edges ?? []),
        ]);
        setTagSuggestions((current) =>
          [...new Set([...current, ...(result.note.tags ?? [])])].sort(
            (left, right) => left.localeCompare(right),
          ),
        );
        toast.success("Note created");
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to create note"));
        return false;
      }
    },
    [applyUpdatedNote, client, groups],
  );

  const handleCreateGroup = useCallback(
    async (input: {
      name: string;
      description: string;
      parentId: string | null;
    }) => {
      const name = input.name.trim();
      if (!name) {
        toast.error("Name is required");
        return null;
      }

      try {
        const result = await client.post<{ group: INoteGroup }>("note-groups", {
          name,
          description: input.description.trim() || undefined,
          parentId: input.parentId,
        });
        setGroups((current) =>
          [...current, result.group].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        );
        toast.success("Folder created");
        return result.group;
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to create folder"));
        return null;
      }
    },
    [client],
  );

  const handleUpdateGroup = useCallback(
    async (id: string, patch: Partial<INoteGroup>) => {
      const previousGroups = groups;

      setGroups((current) =>
        current.map((group) =>
          group._id === id ? { ...group, ...patch } : group,
        ),
      );

      try {
        const result = await client.patch<{ group: INoteGroup }>(
          `note-groups/${id}`,
          patch,
        );
        setGroups((current) =>
          current.map((group) => (group._id === id ? result.group : group)),
        );
        if (patch.parentId !== undefined) await load(true);
      } catch (error) {
        setGroups(previousGroups);
        toast.error(getErrorMessage(error, "Failed to update folder"));
      }
    },
    [client, groups, load],
  );

  const handleDeleteGroup = useCallback(
    async (id: string) => {
      const previousGroups = groups;
      const previousNotes = notes;

      setGroups((current) => current.filter((group) => group._id !== id));
      setNotes((current) =>
        current.map((note) => ({
          ...note,
          groupIds: (note.groupIds ?? []).filter((groupId) => groupId !== id),
        })),
      );
      if (selectedGroupId === id) setSelectedGroupId(null);

      try {
        await client.del<{ success: true }>(`note-groups/${id}`);
        toast.success("Folder deleted");
        await load(true);
      } catch (error) {
        setGroups(previousGroups);
        setNotes(previousNotes);
        toast.error(getErrorMessage(error, "Failed to delete folder"));
      }
    },
    [client, groups, load, notes, selectedGroupId],
  );

  if (loading) {
    return <NotesSkeleton />;
  }

  if (selectedNote) {
    return (
      <NoteDetail
        note={selectedNote}
        allNotes={notes}
        groups={groups}
        edges={edges}
        suggestions={allTags}
        onPatch={(body) => handlePatchNote(selectedNote._id, body)}
        onDelete={() => handleDeleteNote(selectedNote._id)}
        onBack={() => setSelectedId(null)}
        onSelectNote={(note) => {
          setSelectedGroupId(null);
          setSelectedId(note._id);
        }}
        onSuggestionsChange={setTagSuggestions}
        onUpdated={applyUpdatedNote}
      />
    );
  }

  if (selectedGroup) {
    return (
      <GroupDetail
        group={selectedGroup}
        groups={groups}
        notes={notes}
        onBack={() => setSelectedGroupId(null)}
        onUpdate={handleUpdateGroup}
        onDelete={handleDeleteGroup}
        onSelectNote={(note) => {
          setSelectedGroupId(null);
          setSelectedId(note._id);
        }}
        onSelectGroup={(group) => setSelectedGroupId(group._id)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {slots?.sidebarTrigger}
          <FileText className="size-4 shrink-0" />
          <h1 className="text-sm font-medium">Notes</h1>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground sm:ml-0">
            {sortedNotes.length} / {notes.length} - {groups.length} folders
          </span>
        </div>

        <div className="flex w-full items-center gap-1 sm:w-auto">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => void load(true)}
            title="Refresh"
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setNewGroupParentId(folderCurrentId)}
          >
            <FolderPlus className="size-3.5" />
            <span className="hidden sm:inline">Folder</span>
          </Button>

          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => setNewNoteParentId(folderCurrentId)}
          >
            <FilePlus2 className="size-3.5" />
            <span className="hidden sm:inline">Note</span>
          </Button>
        </div>

        <div className="relative order-last w-full sm:order-none sm:ml-auto sm:w-80">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes..."
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="flex shrink-0 gap-2 overflow-x-auto border-b px-3 py-2 sm:flex-wrap sm:px-4">
        <div className="flex shrink-0 items-center gap-2">
          <FolderTree className="size-3.5 text-muted-foreground" />
          <GroupTreeCombobox
            groups={groups}
            value={selectedGroupFilters}
            onChange={setSelectedGroupFilters}
            placeholder="Filter folders..."
            searchPlaceholder="Search folder hierarchy..."
            emptyMessage="No folders yet"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Tags className="size-3.5 text-muted-foreground" />
          <TagAutocomplete
            value={selectedTagFilters}
            onChange={setSelectedTagFilters}
            suggestions={allTags}
            placeholder="Filter tags..."
            allowCreate={false}
            searchPlaceholder="Search tags..."
            emptyMessage="No tags found"
          />
        </div>

        <Select
          value={hasUrlFilter}
          onValueChange={(value) => setHasUrlFilter(value as HasUrlFilter)}
        >
          <SelectTrigger size="sm" className="h-8 w-36 shrink-0 text-xs">
            <div className="flex items-center gap-1.5">
              <Link2 className="size-3.5" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all" className="text-xs">
              All links
            </SelectItem>
            <SelectItem value="with-url" className="text-xs">
              With URL
            </SelectItem>
            <SelectItem value="without-url" className="text-xs">
              Without URL
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger size="sm" className="h-8 w-32 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all" className="text-xs">
              All status
            </SelectItem>
            <SelectItem value="open" className="text-xs">
              Open
            </SelectItem>
            <SelectItem value="archived" className="text-xs">
              Archived
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
          <SelectTrigger size="sm" className="h-8 w-40 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="updated-desc" className="text-xs">
              Updated newest
            </SelectItem>
            <SelectItem value="updated-asc" className="text-xs">
              Updated oldest
            </SelectItem>
            <SelectItem value="created-desc" className="text-xs">
              Created newest
            </SelectItem>
            <SelectItem value="created-asc" className="text-xs">
              Created oldest
            </SelectItem>
            <SelectItem value="title-asc" className="text-xs">
              Title A-Z
            </SelectItem>
            <SelectItem value="title-desc" className="text-xs">
              Title Z-A
            </SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            onClick={() => {
              setQuery("");
              setSelectedGroupFilters([]);
              setSelectedTagFilters([]);
              setHasUrlFilter("all");
              setStatusFilter("all");
              setSort("updated-desc");
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <NoteFolderView
          notes={sortedNotes}
          groups={groups}
          currentId={folderCurrentId}
          onCurrentIdChange={setFolderCurrentId}
          onSelect={(note) => {
            setSelectedGroupId(null);
            setSelectedId(note._id);
          }}
          onSelectGroup={(group) => {
            setSelectedId(null);
            setSelectedGroupId(group._id);
          }}
          onCreateNoteHere={setNewNoteParentId}
          onCreateFolderHere={setNewGroupParentId}
          onDeleteNote={setPendingDeleteNote}
          onDeleteGroup={setPendingDeleteGroup}
        />
      </div>

      <NewNoteDialog
        open={newNoteParentId !== undefined}
        parentId={newNoteParentId ?? null}
        groups={groups}
        onOpenChange={(open) => {
          if (!open) setNewNoteParentId(undefined);
        }}
        onCreate={handleCreateNote}
      />

      <NewGroupDialog
        open={newGroupParentId !== undefined}
        parentId={newGroupParentId ?? null}
        groups={groups}
        onOpenChange={(open) => {
          if (!open) setNewGroupParentId(undefined);
        }}
        onCreate={handleCreateGroup}
      />

      <AlertDialog
        open={pendingDeleteNote !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteNote(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes "{pendingDeleteNote?.title}". This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDeleteNote) {
                  void handleDeleteNote(pendingDeleteNote._id);
                }
                setPendingDeleteNote(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeleteGroup !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteGroup(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Notes inside "{pendingDeleteGroup?.name}" are kept but removed
              from this folder. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDeleteGroup) {
                  void handleDeleteGroup(pendingDeleteGroup._id);
                }
                setPendingDeleteGroup(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewNoteDialog({
  open,
  parentId,
  groups,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  parentId: string | null;
  groups: INoteGroup[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    title: string;
    url: string;
    content: string;
    groupIds: string[];
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setUrl("");
    setContent("");
    setGroupIds(parentId ? [parentId] : []);
  }, [open, parentId]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const created = await onCreate({ title, url, content, groupIds });
    setSubmitting(false);
    if (created) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>New note</DialogTitle>
        <DialogDescription className="sr-only">
          Create a note in the selected folder.
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-note-title">Title</Label>
            <Input
              id="new-note-title"
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder="Untitled note"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-note-url">URL</Label>
            <Input
              id="new-note-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Folder</Label>
            <GroupTreeCombobox
              groups={groups}
              value={groupIds}
              onChange={setGroupIds}
              placeholder="Choose folder..."
              searchPlaceholder="Search folder hierarchy..."
              emptyMessage="No folders yet"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-note-content">Content</Label>
            <Textarea
              id="new-note-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-32 resize-y text-sm"
              placeholder="Markdown"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FilePlus2 className="size-3.5" />
            )}
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewGroupDialog({
  open,
  parentId,
  groups,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  parentId: string | null;
  groups: INoteGroup[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    name: string;
    description: string;
    parentId: string | null;
  }) => Promise<INoteGroup | null>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setSelectedParentId(parentId);
  }, [open, parentId]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const group = await onCreate({
      name,
      description,
      parentId: selectedParentId,
    });
    setSubmitting(false);
    if (group) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>New folder</DialogTitle>
        <DialogDescription className="sr-only">
          Create a note folder.
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-folder-name">Name</Label>
            <Input
              id="new-folder-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder="Research"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-folder-description">Description</Label>
            <Textarea
              id="new-folder-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 text-sm"
              placeholder="What this folder is about..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Parent folder</Label>
            <GroupTreeCombobox
              groups={groups}
              value={selectedParentId ? [selectedParentId] : []}
              onChange={(next) => setSelectedParentId(next.at(-1) ?? null)}
              placeholder="Top-level"
              searchPlaceholder="Search folder hierarchy..."
              emptyMessage="No folders yet"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderPlus className="size-3.5" />
            )}
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
