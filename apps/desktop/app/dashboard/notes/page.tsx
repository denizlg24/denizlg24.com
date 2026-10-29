"use client";

import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List as ListBlock, ListRow } from "@repo/ui/list";
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
import { FilterTabs, SearchField, ToolbarSpacer } from "@repo/ui/toolbar";
import {
  ArrowDownUp,
  BrainCircuit,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderTree,
  Globe,
  Link2,
  List,
  Loader2,
  Network,
  RefreshCcw,
  Tags,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TagAutocomplete } from "@/app/dashboard/notes/_components/tag-autocomplete";
import { useEntityGraphData } from "@/components/graph/entity-graph";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  INote,
  INoteEdge,
  INoteGraph,
  INoteGroup,
} from "@/lib/data-types";
import { buildDescendantIdMap, buildPathLabelMap } from "@/lib/note-group-tree";
import { classifyNoteLocally } from "@/lib/semantic/classify-note";
import { GroupDetail } from "./_components/group-detail";
import { GroupTreeCombobox } from "./_components/group-tree-combobox";
import { NewGroupDialog } from "./_components/new-group-dialog";
import { NoteDetail } from "./_components/note-detail";
import { NoteFolderView } from "./_components/note-folder-view";
import { relativeDate } from "./_components/note-format";
import { getNoteGroupIds, NoteGraph } from "./_components/note-graph";
import { SemanticPanel } from "./_components/semantic-panel";

type View = "list" | "folders" | "graph";
type Sort =
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc"
  | "title-asc"
  | "title-desc";

const AUTO_CLASSIFY_FIELDS = new Set([
  "title",
  "content",
  "url",
  "description",
  "siteName",
  "class",
  "tags",
]);

function shouldAutoClassify(body: Record<string, unknown>) {
  return Object.keys(body ?? {}).some((key) => AUTO_CLASSIFY_FIELDS.has(key));
}
type HasUrlFilter = "all" | "with-url" | "without-url";
type StatusFilter = "all" | INote["status"];

function parseHttpUrl(text: string) {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function isEditablePasteTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const editableAncestor = target.closest(
    "input, textarea, [contenteditable='true'], [role='textbox']",
  );

  return Boolean(editableAncestor);
}

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

export default function NotesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi();
  }, [settings, loadingSettings]);

  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notes, setNotes] = useState<INote[]>([]);
  const [groups, setGroups] = useState<INoteGroup[]>([]);
  const [edges, setEdges] = useState<INoteEdge[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedGroupFilters, setSelectedGroupFilters] = useState<string[]>(
    [],
  );
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [hasUrlFilter, setHasUrlFilter] = useState<HasUrlFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("updated-desc");
  const [importingLink, setImportingLink] = useState(false);
  const [semanticOpen, setSemanticOpen] = useState(false);
  const [folderCurrentId, setFolderCurrentId] = useState<string | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] = useState<INote | null>(
    null,
  );
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    useState<INoteGroup | null>(null);

  const goNewNote = useCallback(
    (groupId: string | null) => {
      router.push(
        groupId
          ? `/dashboard/notes/new?group=${encodeURIComponent(groupId)}`
          : "/dashboard/notes/new",
      );
    },
    [router],
  );

  const [newGroupParentId, setNewGroupParentId] = useState<
    string | null | undefined
  >(undefined);
  const goNewGroup = useCallback((parentId: string | null) => {
    setNewGroupParentId(parentId);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!api) return;

      if (silent) setRefreshing(true);
      else setLoading(true);

      const [graphResult, tagsResult] = await Promise.all([
        api.GET<INoteGraph>({ endpoint: "notes" }),
        api.GET<{ tags: string[] }>({ endpoint: "notes/tags" }),
      ]);

      if ("code" in graphResult) {
        toast.error(graphResult.message);
      } else {
        setNotes(graphResult.notes);
        setGroups(graphResult.groups);
        setEdges(graphResult.edges);
      }

      if ("code" in tagsResult) {
        if (!silent) toast.error(tagsResult.message);
      } else {
        setTagSuggestions(tagsResult.tags);
      }

      if (silent) setRefreshing(false);
      else setLoading(false);
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

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

  useEffect(() => {
    const deepLinkedNoteId = searchParams.get("note");
    if (!deepLinkedNoteId || notes.length === 0) return;

    const nextNote = notes.find((note) => note._id === deepLinkedNoteId);
    if (nextNote) {
      setSelectedGroupId(null);
      setSelectedId(nextNote._id);
    }

    router.replace("/dashboard/notes");
  }, [notes, router, searchParams]);

  const applyUpdatedNote = useCallback((next: INote) => {
    setNotes((current) =>
      current.some((note) => note._id === next._id)
        ? current.map((note) => (note._id === next._id ? next : note))
        : [next, ...current],
    );
    setSelectedGroupId(null);
    setSelectedId(next._id);
  }, []);

  const autoClassifyNote = useCallback(
    async (note: INote, toastId?: string | number) => {
      if (!api) return { note, classified: false };

      try {
        const result = await classifyNoteLocally({
          api,
          note,
          groups,
        });
        applyUpdatedNote(result.note);
        setGroups(result.groups ?? []);
        return { note: result.note, classified: true };
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `Local classification failed: ${error.message}`
            : "Local classification failed",
          toastId ? { id: toastId } : undefined,
        );
        return { note, classified: false };
      }
    },
    [api, applyUpdatedNote, groups],
  );

  const handlePatchNote = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      if (!api) return null;

      const result = await api.PATCH<{ note: INote }>({
        endpoint: `notes/${id}`,
        body,
      });

      if ("code" in result) {
        toast.error(result.message);
        return null;
      }

      applyUpdatedNote(result.note);
      if (shouldAutoClassify(body)) {
        void autoClassifyNote(result.note);
      }
      return result.note;
    },
    [api, applyUpdatedNote, autoClassifyNote],
  );

  const handleDeleteNote = useCallback(
    async (id: string) => {
      if (!api) return;

      const previousNotes = notes;
      const previousEdges = edges;

      setNotes((current) => current.filter((note) => note._id !== id));
      setEdges((current) =>
        current.filter((edge) => edge.from !== id && edge.to !== id),
      );
      setSelectedId(null);

      const result = await api.DELETE<{ success: true }>({
        endpoint: `notes/${id}`,
      });

      if ("code" in result) {
        toast.error(result.message);
        setNotes(previousNotes);
        setEdges(previousEdges);
        return;
      }

      toast.success("Note deleted");
    },
    [api, edges, notes],
  );

  const handleAddEdge = useCallback(
    async (from: string, to: string) => {
      if (!api) return;
      const result = await api.POST<{ edge: INoteEdge }>({
        endpoint: "notes/edges",
        body: { from, to },
      });
      if ("code" in result) {
        toast.error(result.message);
        return;
      }
      setEdges((current) => [
        ...current.filter((edge) => edge._id !== result.edge._id),
        result.edge,
      ]);
    },
    [api],
  );

  const handleRemoveEdge = useCallback(
    async (edgeId: string) => {
      if (!api) return;
      const previousEdges = edges;
      setEdges((current) => current.filter((edge) => edge._id !== edgeId));
      const result = await api.DELETE<{ success: true }>({
        endpoint: `notes/edges/${edgeId}`,
      });
      if ("code" in result) {
        toast.error(result.message);
        setEdges(previousEdges);
      }
    },
    [api, edges],
  );

  const handlePasteImport = useCallback(
    async (url: string) => {
      if (!api || importingLink) return;

      setImportingLink(true);
      const toastId = toast.loading("Importing link...");

      const result = await api.POST<{
        note: INote;
        groups: INoteGroup[];
        edges: INoteEdge[];
      }>({
        endpoint: "notes",
        body: { url, skipCategorize: true },
      });

      setImportingLink(false);

      if ("code" in result) {
        toast.error(result.message, { id: toastId });
        return;
      }

      setGroups(result.groups ?? []);
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
      applyUpdatedNote(result.note);
      setView("list");
      const { classified } = await autoClassifyNote(result.note);
      toast.success(
        classified ? "Link imported and classified" : "Link imported",
        { id: toastId },
      );
    },
    [api, applyUpdatedNote, autoClassifyNote, importingLink],
  );

  const handleCategorizeNote = useCallback(
    async (id: string) => {
      if (!api) return;

      const result = await api.POST<{
        note: INote;
        groups: INoteGroup[];
        edges: INoteEdge[];
      }>({
        endpoint: `notes/${id}/categorize`,
        body: {},
      });

      if ("code" in result) {
        toast.error(result.message);
        return;
      }

      applyUpdatedNote(result.note);
      setGroups(result.groups ?? []);
      setEdges((current) => [
        ...current.filter((edge) => edge.from !== id && edge.to !== id),
        ...(result.edges ?? []),
      ]);
      setTagSuggestions((current) =>
        [...new Set([...current, ...(result.note.tags ?? [])])].sort(
          (left, right) => left.localeCompare(right),
        ),
      );
      toast.success("Note categorized");
    },
    [api, applyUpdatedNote],
  );

  const handleUpdateGroup = useCallback(
    async (id: string, patch: Partial<INoteGroup>) => {
      if (!api) return;

      const previousGroups = groups;

      setGroups((current) =>
        current.map((group) =>
          group._id === id ? { ...group, ...patch } : group,
        ),
      );

      const result = await api.PATCH<{ group: INoteGroup }>({
        endpoint: `note-groups/${id}`,
        body: patch,
      });

      if ("code" in result) {
        toast.error(result.message);
        setGroups(previousGroups);
        return;
      }

      setGroups((current) =>
        current.map((group) => (group._id === id ? result.group : group)),
      );

      if (patch.parentId !== undefined) {
        await load(true);
      }
    },
    [api, groups, load],
  );

  const handleDeleteGroup = useCallback(
    async (id: string) => {
      if (!api) return;

      const previousGroups = groups;
      const previousNotes = notes;

      setGroups((current) => current.filter((group) => group._id !== id));
      setNotes((current) =>
        current.map((note) => ({
          ...note,
          groupIds: (note.groupIds ?? []).filter((groupId) => groupId !== id),
        })),
      );
      setSelectedGroupId(null);

      const result = await api.DELETE<{ success: true }>({
        endpoint: `note-groups/${id}`,
      });

      if ("code" in result) {
        toast.error(result.message);
        setGroups(previousGroups);
        setNotes(previousNotes);
        return;
      }

      toast.success("Group deleted");
      await load(true);
    },
    [api, groups, notes, load],
  );

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

  const { visibleGroups: graphGroups, visibleEdges: graphEdges } =
    useEntityGraphData({
      items: sortedNotes,
      groups,
      edges,
      getItemGroupIds: getNoteGroupIds,
    });

  const selectedNote = useMemo(
    () => notes.find((note) => note._id === selectedId) ?? null,
    [notes, selectedId],
  );

  useEffect(() => {
    if (selectedNote?.paperId) {
      setSelectedId(null);
      router.push(
        `/dashboard/papers?paper=${encodeURIComponent(selectedNote.paperId)}`,
      );
    }
  }, [router, selectedNote?.paperId]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group._id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (importingLink || isEditablePasteTarget(event.target)) {
        return;
      }

      const text = event.clipboardData?.getData("text") ?? "";
      const url = parseHttpUrl(text);
      if (!url) return;

      event.preventDefault();
      void handlePasteImport(url);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePasteImport, importingLink]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    selectedGroupFilters.length > 0 ||
    selectedTagFilters.length > 0 ||
    hasUrlFilter !== "all" ||
    statusFilter !== "all" ||
    sort !== "updated-desc";

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
    return <NotesLoadingSkeleton />;
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
        onUpdated={(note) => {
          applyUpdatedNote(note);
          void autoClassifyNote(note);
        }}
        onAddEdge={handleAddEdge}
        onRemoveEdge={handleRemoveEdge}
        api={api}
        onCategorize={() => handleCategorizeNote(selectedNote._id)}
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
        leading={<SidebarTrigger className="-ml-1 size-7 md:hidden" />}
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
          onClick={() => setSemanticOpen(true)}
          aria-label="Semantic"
          title="Semantic"
        >
          <BrainCircuit />
        </Button>
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
            goNewGroup(view === "folders" ? folderCurrentId : null)
          }
        >
          <FolderPlus />
          Group
        </Button>
        <Button
          size="sm"
          onClick={() => goNewNote(view === "folders" ? folderCurrentId : null)}
        >
          <FilePlus2 />
          Note
        </Button>
      </PageHeader>

      <PageToolbar>
        <FilterTabs
          value={view}
          onChange={setView}
          options={[
            {
              value: "list",
              label: <List className="size-3.5" aria-label="List" />,
            },
            {
              value: "folders",
              label: <FolderTree className="size-3.5" aria-label="Folders" />,
            },
            {
              value: "graph",
              label: <Network className="size-3.5" aria-label="Graph" />,
            },
          ]}
        />
        <SearchField value={query} onChange={setQuery} className="w-56" />
        <GroupTreeCombobox
          variant="toolbar"
          icon={<FolderTree className="size-3.5" />}
          groups={groups}
          value={selectedGroupFilters}
          onChange={setSelectedGroupFilters}
          placeholder="Groups"
          searchPlaceholder="Search groups…"
          emptyMessage="No groups"
        />
        <TagAutocomplete
          variant="toolbar"
          icon={<Tags className="size-3.5" />}
          value={selectedTagFilters}
          onChange={setSelectedTagFilters}
          suggestions={allTags}
          placeholder="Tags"
          allowCreate={false}
          searchPlaceholder="Search tags…"
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
                <ListBlock>
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
                </ListBlock>
              )}
            </SplitList>
          }
          detail={detail}
        />
      ) : (
        <PageBody bleed>
          {view === "graph" ? (
            <NoteGraph
              notes={sortedNotes}
              groups={graphGroups}
              edges={graphEdges}
              onSelectNote={selectNote}
              onSelectGroup={selectGroup}
              onCreateNoteHere={goNewNote}
              onCreateFolderHere={goNewGroup}
              onCategorizeNote={(note) => handleCategorizeNote(note._id)}
              onDeleteNote={setPendingDeleteNote}
              onDeleteGroup={setPendingDeleteGroup}
            />
          ) : (
            <NoteFolderView
              notes={sortedNotes}
              groups={groups}
              currentId={folderCurrentId}
              onCurrentIdChange={setFolderCurrentId}
              onSelect={selectNote}
              onSelectGroup={selectGroup}
              onCreateNoteHere={goNewNote}
              onCreateFolderHere={goNewGroup}
              onCategorizeNote={(note) => handleCategorizeNote(note._id)}
              onDeleteNote={setPendingDeleteNote}
              onDeleteGroup={setPendingDeleteGroup}
            />
          )}
        </PageBody>
      )}

      <NewGroupDialog
        api={api}
        open={newGroupParentId !== undefined}
        parentId={newGroupParentId ?? null}
        groups={groups}
        onOpenChange={(open) => {
          if (!open) setNewGroupParentId(undefined);
        }}
        onCreated={(group) => {
          setGroups((current) =>
            [...current, group].sort((left, right) =>
              left.name.localeCompare(right.name),
            ),
          );
          toast.success("Group created");
        }}
      />

      {api && semanticOpen && (
        <SemanticPanel
          api={api}
          onClose={() => setSemanticOpen(false)}
          onChanged={() => void load(true)}
        />
      )}

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
        title="Delete group?"
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
      <Image
        src={note.favicon}
        alt=""
        width={14}
        height={14}
        className="size-3.5 rounded-sm"
        unoptimized
      />
    );
  }
  return note.url ? <Globe /> : <FileText />;
}

function NotesLoadingSkeleton() {
  return (
    <Page>
      <PageHeader
        leading={<SidebarTrigger className="-ml-1 size-7 md:hidden" />}
        icon={<FileText />}
        title="Notes"
      >
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-16" />
      </PageHeader>
      <PageToolbar>
        <Skeleton className="h-7 w-24" />
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
