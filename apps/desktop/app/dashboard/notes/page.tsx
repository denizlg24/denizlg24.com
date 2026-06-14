"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import {
  BrainCircuit,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderTree,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  RefreshCcw,
  Tags,
  X,
} from "lucide-react";
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
import { NoteDetail } from "./_components/note-detail";
import { NoteFolderView } from "./_components/note-folder-view";
import { getNoteGroupIds, NoteGraph } from "./_components/note-graph";
import { SemanticPanel } from "./_components/semantic-panel";

type View = "graph" | "list";
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
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [view, setView] = useState<View>("graph");
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

  const selectedGroup = useMemo(
    () => groups.find((group) => group._id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (
        importingLink ||
        selectedId ||
        selectedGroupId ||
        isEditablePasteTarget(event.target)
      ) {
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
  }, [handlePasteImport, importingLink, selectedGroupId, selectedId]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    selectedGroupFilters.length > 0 ||
    selectedTagFilters.length > 0 ||
    hasUrlFilter !== "all" ||
    statusFilter !== "all" ||
    sort !== "updated-desc";

  if (loading) {
    return <NotesLoadingSkeleton />;
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
        onUpdated={(note) => {
          applyUpdatedNote(note);
          void autoClassifyNote(note);
        }}
        api={api}
        onCategorize={() => handleCategorizeNote(selectedNote._id)}
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
    <div className="relative flex h-full flex-col">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-4 py-2 md:h-12 md:flex-nowrap md:py-0">
        <div className="flex w-full items-center gap-2 md:w-auto">
          <SidebarTrigger className="-ml-1 size-7 md:hidden" />
          <FileText className="size-4" />
          <h1 className="text-sm font-medium">Notes</h1>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground md:ml-0">
            {sortedNotes.length} / {notes.length} · {groups.length} groups
          </span>
        </div>

        <div className="flex w-full grow items-center gap-2 md:ml-2 md:w-auto">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, content, url, tags…"
            className="h-7 w-full! max-w-full! text-xs"
          />

          <Tabs value={view} onValueChange={(value) => setView(value as View)}>
            <TabsList className="h-7!">
              <TabsTrigger value="graph" className="h-5.5 px-2 text-xs">
                <LayoutGrid className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="list" className="h-5.5 px-2 text-xs">
                <List className="size-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setSemanticOpen(true)}
            title="Semantic notes"
          >
            <BrainCircuit className="size-3.5" />
            <span className="hidden lg:inline">Semantic</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => void load(true)}
            title="Refresh"
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => router.push("/dashboard/notes/new-group")}
          >
            <FolderPlus className="size-3.5" />
            <span className="hidden lg:inline">Group</span>
          </Button>

          <Button
            size="sm"
            className="h-7"
            onClick={() => router.push("/dashboard/notes/new")}
          >
            <FilePlus2 className="size-3.5" />
            <span className="hidden lg:inline">Note</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 w-full">
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <FolderTree className="size-3.5" />
          </span>
          <GroupTreeCombobox
            groups={groups}
            value={selectedGroupFilters}
            onChange={setSelectedGroupFilters}
            placeholder="Filter groups…"
            searchPlaceholder="Search group hierarchy…"
            emptyMessage="No groups yet"
          />
        </div>

        <div className="flex min-w-0 max-w-full items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Tags className="size-3.5" />
          </span>
          <TagAutocomplete
            value={selectedTagFilters}
            onChange={setSelectedTagFilters}
            suggestions={allTags}
            placeholder="Filter tags…"
            allowCreate={false}
            searchPlaceholder="Search tags…"
            emptyMessage="No tags found"
          />
        </div>

        <Select
          value={hasUrlFilter}
          onValueChange={(value) => setHasUrlFilter(value as HasUrlFilter)}
        >
          <SelectTrigger size="sm" className="w-32 text-xs ml-auto">
            <div className="flex items-center gap-1.5 h-4!">
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
          <SelectTrigger size="sm" className="h-7 w-32 text-xs">
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
          <SelectTrigger size="sm" className="h-7 w-40 text-xs">
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
            className="h-7 px-2 text-xs"
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

      <div className="flex-1 overflow-hidden">
        {view === "graph" ? (
          <NoteGraph
            notes={sortedNotes}
            groups={graphGroups}
            edges={graphEdges}
            onSelectNote={(note) => {
              setSelectedGroupId(null);
              setSelectedId(note._id);
            }}
            onSelectGroup={(group) => {
              setSelectedId(null);
              setSelectedGroupId(group._id);
            }}
          />
        ) : (
          <NoteFolderView
            notes={sortedNotes}
            groups={groups}
            onSelect={(note) => {
              setSelectedGroupId(null);
              setSelectedId(note._id);
            }}
            onSelectGroup={(group) => {
              setSelectedId(null);
              setSelectedGroupId(group._id);
            }}
          />
        )}
      </div>
      {api && semanticOpen && (
        <SemanticPanel
          api={api}
          onClose={() => setSemanticOpen(false)}
          onChanged={() => void load(true)}
        />
      )}
    </div>
  );
}

function NotesLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1 size-7 md:hidden" />
          <FileText className="size-4" />
          <h1 className="text-sm font-medium">Notes</h1>
          <Skeleton className="h-3 w-28" />
        </div>

        <div className="flex items-center gap-2 grow ml-2">
          <Skeleton className="h-7 grow" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-9" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 w-full">
        <div className="flex items-center gap-2">
          <FolderTree className="size-3.5 text-muted-foreground" />
          <Skeleton className="h-8 w-44" />
        </div>
        <div className="flex items-center gap-2">
          <Tags className="size-3.5 text-muted-foreground" />
          <Skeleton className="h-8 w-44" />
        </div>
        <Skeleton className="ml-auto h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-40" />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}
