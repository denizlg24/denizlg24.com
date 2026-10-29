"use client";

import type { INote, INoteEdge, INoteGraph, INoteGroup } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { SplitList, SplitView } from "@repo/ui/split-view";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs, SearchField, ToolbarSpacer } from "@repo/ui/toolbar";
import {
  ArrowDownUp,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderTree,
  Globe,
  Link2,
  List as ListIcon,
  Loader2,
  RefreshCcw,
  Tags,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { relativeDate } from "./format";
import { GroupDetail } from "./group-detail";
import { buildDescendantIdMap, buildPathLabelMap } from "./group-tree";
import { GroupTreeCombobox } from "./group-tree-combobox";
import { NoteDetail } from "./note-detail";
import { NoteFolderView } from "./note-folder-view";
import { TagAutocomplete } from "./tag-autocomplete";

type View = "list" | "folders";
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
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<FileText />}
        title="Notes"
      >
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
      </PageHeader>
      <PageToolbar>
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
      </PageToolbar>
      <SplitView
        detailOpen={false}
        listWidth="md:w-80 lg:w-96"
        list={
          <SplitList>
            <div className="flex flex-col gap-1">
              {Array.from({ length: 14 }).map((_, index) => (
                <div key={index} className="flex h-9 items-center gap-3">
                  <Skeleton className="size-4 rounded-sm" />
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </SplitList>
        }
        detail={null}
      />
    </Page>
  );
}

export function NotesPage() {
  const { client, platform, slots } = useAdmin();

  const [view, setView] = useState<View>("list");
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

  useEffect(() => {
    if (selectedNote?.paperId) {
      void platform.navigate(
        `/papers?paper=${encodeURIComponent(selectedNote.paperId)}`,
      );
    }
  }, [platform, selectedNote?.paperId]);
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

  const selectNote = (note: INote) => {
    setSelectedGroupId(null);
    setSelectedId(note._id);
    setView("list");
  };

  const selectGroup = (group: INoteGroup) => {
    setSelectedId(null);
    setSelectedGroupId(group._id);
    setView("list");
  };

  const clearFilters = () => {
    setQuery("");
    setSelectedGroupFilters([]);
    setSelectedTagFilters([]);
    setHasUrlFilter("all");
    setStatusFilter("all");
    setSort("updated-desc");
  };

  if (loading) {
    return <NotesSkeleton />;
  }

  const showsCreated = sort === "created-desc" || sort === "created-asc";

  const detail = selectedNote ? (
    selectedNote.paperId ? (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ) : (
      <NoteDetail
        key={selectedNote._id}
        note={selectedNote}
        allNotes={notes}
        groups={groups}
        edges={edges}
        suggestions={allTags}
        onPatch={(body) => handlePatchNote(selectedNote._id, body)}
        onDelete={() => handleDeleteNote(selectedNote._id)}
        onBack={() => setSelectedId(null)}
        onSelectNote={selectNote}
        onSuggestionsChange={setTagSuggestions}
        onUpdated={applyUpdatedNote}
      />
    )
  ) : selectedGroup ? (
    <GroupDetail
      key={selectedGroup._id}
      group={selectedGroup}
      groups={groups}
      notes={notes}
      onBack={() => setSelectedGroupId(null)}
      onUpdate={handleUpdateGroup}
      onDelete={handleDeleteGroup}
      onSelectNote={selectNote}
      onSelectGroup={selectGroup}
    />
  ) : (
    <EmptyState icon={<FileText />} label={`${notes.length} notes`} />
  );

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<FileText />}
        title="Notes"
      >
        <span className="mr-1 text-xs tabular-nums text-muted-foreground">
          {sortedNotes.length === notes.length
            ? notes.length
            : `${sortedNotes.length}/${notes.length}`}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCcw className={refreshing ? "animate-spin" : undefined} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setNewGroupParentId(view === "folders" ? folderCurrentId : null)
          }
        >
          <FolderPlus />
          <span className="hidden sm:inline">Folder</span>
        </Button>
        <Button
          size="sm"
          onClick={() =>
            setNewNoteParentId(view === "folders" ? folderCurrentId : null)
          }
        >
          <FilePlus2 />
          <span className="hidden sm:inline">Note</span>
        </Button>
      </PageHeader>

      <PageToolbar>
        <FilterTabs
          value={view}
          onChange={setView}
          options={[
            {
              value: "list",
              label: <ListIcon className="size-3.5" aria-label="List" />,
            },
            {
              value: "folders",
              label: <FolderTree className="size-3.5" aria-label="Folders" />,
            },
          ]}
        />
        <SearchField
          value={query}
          onChange={setQuery}
          className="w-full sm:w-56"
        />
        <GroupTreeCombobox
          variant="toolbar"
          icon={<FolderTree className="size-3.5" />}
          groups={groups}
          value={selectedGroupFilters}
          onChange={setSelectedGroupFilters}
          placeholder="Folders"
          searchPlaceholder="Search folders..."
          emptyMessage="No folders"
        />
        <TagAutocomplete
          variant="toolbar"
          icon={<Tags className="size-3.5" />}
          value={selectedTagFilters}
          onChange={setSelectedTagFilters}
          suggestions={allTags}
          placeholder="Tags"
          allowCreate={false}
          searchPlaceholder="Search tags..."
          emptyMessage="No tags"
        />
        <FilterTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "archived", label: "Archived" },
          ]}
        />
        <ToolbarSpacer />
        <Select
          value={hasUrlFilter}
          onValueChange={(value) => setHasUrlFilter(value as HasUrlFilter)}
        >
          <SelectTrigger size="sm" className="w-auto border-none text-[13px]">
            <Link2 className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value="all">Any link</SelectItem>
            <SelectItem value="with-url">With URL</SelectItem>
            <SelectItem value="without-url">Without URL</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
          <SelectTrigger size="sm" className="w-auto border-none text-[13px]">
            <ArrowDownUp className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value="updated-desc">Updated, newest</SelectItem>
            <SelectItem value="updated-asc">Updated, oldest</SelectItem>
            <SelectItem value="created-desc">Created, newest</SelectItem>
            <SelectItem value="created-asc">Created, oldest</SelectItem>
            <SelectItem value="title-asc">Title A–Z</SelectItem>
            <SelectItem value="title-desc">Title Z–A</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            Clear
          </Button>
        )}
      </PageToolbar>

      {view === "list" ? (
        <SplitView
          detailOpen={selectedNote !== null || selectedGroup !== null}
          listWidth="md:w-80 lg:w-96"
          list={
            <SplitList>
              {sortedNotes.length === 0 ? (
                <EmptyState
                  compact
                  icon={<FileText />}
                  label={notes.length === 0 ? "No notes" : "No matches"}
                />
              ) : (
                <List>
                  {sortedNotes.map((note) => (
                    <ListRow
                      key={note._id}
                      selected={note._id === selectedId}
                      onClick={() => selectNote(note)}
                      leading={<NoteRowGlyph note={note} />}
                      title={note.title || "Untitled"}
                      meta={relativeDate(
                        showsCreated ? note.createdAt : note.updatedAt,
                      )}
                      className={
                        note.status === "archived" ? "opacity-60" : undefined
                      }
                    />
                  ))}
                </List>
              )}
            </SplitList>
          }
          detail={detail}
        />
      ) : (
        <PageBody bleed>
          <NoteFolderView
            notes={sortedNotes}
            groups={groups}
            currentId={folderCurrentId}
            onCurrentIdChange={setFolderCurrentId}
            onSelect={selectNote}
            onSelectGroup={selectGroup}
            onCreateNoteHere={setNewNoteParentId}
            onCreateFolderHere={setNewGroupParentId}
            onDeleteNote={setPendingDeleteNote}
            onDeleteGroup={setPendingDeleteGroup}
          />
        </PageBody>
      )}

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

      <ConfirmDialog
        open={pendingDeleteNote !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteNote(null);
        }}
        title="Delete note?"
        description={pendingDeleteNote?.title || "Untitled"}
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDeleteNote) void handleDeleteNote(pendingDeleteNote._id);
          setPendingDeleteNote(null);
        }}
      />

      <ConfirmDialog
        open={pendingDeleteGroup !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteGroup(null);
        }}
        title="Delete folder?"
        description={pendingDeleteGroup?.name}
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDeleteGroup)
            void handleDeleteGroup(pendingDeleteGroup._id);
          setPendingDeleteGroup(null);
        }}
      />
    </Page>
  );
}

function NoteRowGlyph({ note }: { note: INote }) {
  if (note.favicon) {
    return (
      <img
        src={note.favicon}
        alt=""
        className="size-3.5 rounded-sm"
        loading="lazy"
      />
    );
  }
  return note.url ? <Globe /> : <FileText />;
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

  const pathLabelById = useMemo(() => buildPathLabelMap(groups), [groups]);

  const submit = async () => {
    setSubmitting(true);
    const created = await onCreate({ title, url, content, groupIds });
    setSubmitting(false);
    if (created) onOpenChange(false);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New note"
      size="lg"
      onSubmit={submit}
      submitLabel="Create"
      submitDisabled={!title.trim() && !url.trim()}
      pending={submitting}
    >
      <FormGrid>
        <FormField label="Title" htmlFor="new-note-title">
          <Input
            id="new-note-title"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField label="URL" htmlFor="new-note-url">
          <Input
            id="new-note-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
          />
        </FormField>
        <FormField label="Folders" className="sm:col-span-2">
          <div className="flex min-h-8 flex-wrap items-center gap-1">
            {groupIds.map((groupId) => (
              <Badge key={groupId} variant="secondary" className="max-w-64">
                <span className="truncate">
                  {pathLabelById.get(groupId) ?? groupId}
                </span>
              </Badge>
            ))}
            <GroupTreeCombobox
              groups={groups}
              value={groupIds}
              onChange={setGroupIds}
              placeholder="Add"
              searchPlaceholder="Search folders..."
              emptyMessage="No folders"
            />
          </div>
        </FormField>
        <FormField
          label="Content"
          htmlFor="new-note-content"
          className="sm:col-span-2"
        >
          <Textarea
            id="new-note-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-64 resize-y font-mono text-sm"
            placeholder="Markdown"
          />
        </FormField>
      </FormGrid>
    </FormDialog>
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

  const parent = groups.find((group) => group._id === selectedParentId);

  const submit = async () => {
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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New folder"
      onSubmit={submit}
      submitLabel="Create"
      submitDisabled={!name.trim()}
      pending={submitting}
    >
      <FormGrid>
        <FormField label="Name" htmlFor="new-folder-name">
          <Input
            id="new-folder-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="Parent">
          <div className="flex h-8 items-center gap-1">
            <span className="min-w-0 truncate text-sm text-accent-strong">
              {parent?.name ?? "Top level"}
            </span>
            <GroupTreeCombobox
              groups={groups}
              value={selectedParentId ? [selectedParentId] : []}
              onChange={(next) =>
                setSelectedParentId(
                  next.find((id) => id !== selectedParentId) ?? null,
                )
              }
              placeholder="Choose"
              searchPlaceholder="Search folders..."
              emptyMessage="No folders"
            />
          </div>
        </FormField>
        <FormField
          label="Description"
          htmlFor="new-folder-description"
          className="sm:col-span-2"
        >
          <Textarea
            id="new-folder-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-32"
          />
        </FormField>
      </FormGrid>
    </FormDialog>
  );
}
