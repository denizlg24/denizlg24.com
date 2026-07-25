"use client";

import { formatBytes, pluralize } from "@repo/cloud-ui/format";
import type { StorageFile } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import {
  ArrowDownUp,
  Download,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  List,
  Rows3,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import {
  archiveSizeWarning,
  downloadArchive,
  triggerDownload,
} from "@/lib/download";
import {
  activeDrag,
  beginDrag,
  endDrag,
  isFileDrag,
  readDrop,
} from "@/lib/drag";
import {
  type SelectedEntry,
  store,
  UNDO_WINDOW_MS,
  useFolder,
} from "@/lib/store";
import { readDataTransfer, readFileList, uploads } from "@/lib/uploads";
import { usePreference } from "@/lib/use-preference";
import { useWindowedRows } from "@/lib/use-windowed-rows";
import { Breadcrumbs } from "./breadcrumbs";
import { InlineName } from "./inline-name";
import {
  type BrowserController,
  type Density,
  ItemRow,
  ItemTile,
} from "./item-view";
import { MovePicker } from "./move-picker";
import { PreviewOverlay } from "./preview-overlay";
import {
  type BrowserRow,
  SORT_DIRECTIONS,
  SORT_KEYS,
  SORT_LABELS,
  type SortDirection,
  type SortKey,
  sortRows,
  toRows,
} from "./rows";

const VIEWS = ["grid", "list"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

function toEntries(rows: BrowserRow[]): SelectedEntry[] {
  return rows.map((row) => ({ id: row.id, name: row.name, type: row.type }));
}

export function Browser({ folderId }: { folderId: string }) {
  const router = useRouter();
  const state = useFolder(folderId);

  const [view, setView] = usePreference<(typeof VIEWS)[number]>(
    "view",
    "grid",
    VIEWS,
  );
  const [density, setDensity] = usePreference<Density>(
    "density",
    "comfortable",
    DENSITIES,
  );
  const [sortKey, setSortKey] = usePreference<SortKey>(
    "sort",
    "name",
    SORT_KEYS,
  );
  const [sortDirection, setSortDirection] = usePreference<SortDirection>(
    "sort-direction",
    "asc",
    SORT_DIRECTIONS,
  );

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deepLinkFile, setDeepLinkFile] = useState<StorageFile | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [moving, setMoving] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  const paneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const anchorIndex = useRef<number | null>(null);
  const dragDepth = useRef(0);

  const rows = useMemo(
    () =>
      sortRows(toRows(state.subfolders, state.files), sortKey, sortDirection),
    [state.subfolders, state.files, sortKey, sortDirection],
  );
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );

  // Geometry mirrors the row/tile classes below; it only has to be close
  // enough to keep the scrollbar honest and the overscan covering the gap.
  const rowWindow = useWindowedRows({
    count: rows.length,
    scrollRef,
    estimateLineHeight:
      view === "list"
        ? density === "compact"
          ? 33
          : 41
        : density === "compact"
          ? 116
          : 140,
    minTileWidth:
      view === "grid" ? (density === "compact" ? 112 : 144) : undefined,
    // Mirrors the grid's `gap-1 p-3` below.
    tileGap: 4,
    gridPaddingX: 24,
  });

  // A folder switch must not carry selection or an open preview across.
  useEffect(() => {
    setSelection(new Set());
    setFocusedId(null);
    setRenamingId(null);
    setCreating(false);
    anchorIndex.current = null;
  }, [folderId]);

  // A pending delete lives in a timer, so leaving the page would discard the
  // request and the row would silently reappear on the next load. Commit
  // anything still inside its undo window before the page goes away.
  useEffect(() => {
    const flush = () => store.flushPendingDeletes();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  // Deep links from search land straight on a file.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "preview",
    );
    if (requested) setPreviewId(requested);
  }, [folderId]);

  const syncPreviewUrl = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("preview", id);
    else url.searchParams.delete("preview");
    window.history.replaceState(null, "", url);
  }, []);

  const openPreview = useCallback(
    (id: string | null) => {
      setPreviewId(id);
      if (id === null) setDeepLinkFile(null);
      syncPreviewUrl(id);
    },
    [syncPreviewUrl],
  );

  const previewInPage =
    previewId !== null && state.files.some((file) => file.id === previewId);

  // Only the pages loaded so far live in `state.files`, but a search result can
  // point at a file well past the first page. Rather than paging until it turns
  // up, fetch that one file and preview it on its own.
  useEffect(() => {
    if (!previewId || previewInPage || state.loading) return;
    if (deepLinkFile?.id === previewId) return;
    let active = true;
    api
      .file(previewId)
      .then((file) => {
        if (active) setDeepLinkFile(file);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error("Couldn't open that file", {
          description: errorMessage(error),
        });
        openPreview(null);
      });
    return () => {
      active = false;
    };
  }, [previewId, previewInPage, state.loading, deepLinkFile, openPreview]);

  const previewFiles = previewInPage
    ? state.files
    : deepLinkFile
      ? [deepLinkFile]
      : [];

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    anchorIndex.current = null;
  }, []);

  const scopeOf = useCallback(
    (row: BrowserRow): BrowserRow[] => {
      if (!selection.has(row.id) || selection.size <= 1) return [row];
      return rows.filter((candidate) => selection.has(candidate.id));
    },
    [rows, selection],
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selection.has(row.id)),
    [rows, selection],
  );

  const onPointerSelect = useCallback(
    (row: BrowserRow, event: React.MouseEvent) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      setFocusedId(row.id);
      if (event.shiftKey && anchorIndex.current !== null) {
        const [from, to] = [anchorIndex.current, index].sort((a, b) => a - b);
        setSelection(
          new Set(rows.slice(from, to + 1).map((candidate) => candidate.id)),
        );
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        setSelection((current) => {
          const next = new Set(current);
          if (next.has(row.id)) next.delete(row.id);
          else next.add(row.id);
          return next;
        });
        anchorIndex.current = index;
        return;
      }
      anchorIndex.current = index;
      setSelection(new Set([row.id]));
    },
    [rows],
  );

  const onToggleSelect = useCallback(
    (row: BrowserRow) => {
      anchorIndex.current = rows.findIndex(
        (candidate) => candidate.id === row.id,
      );
      setSelection((current) => {
        const next = new Set(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
    },
    [rows],
  );

  const onOpen = useCallback(
    (row: BrowserRow) => {
      if (row.type === "folder") {
        router.push(`/folders/${row.id}`);
        return;
      }
      openPreview(row.id);
    },
    [openPreview, router],
  );

  const onCommitRename = useCallback(
    async (row: BrowserRow, name: string) => {
      setRenamingId(null);
      try {
        if (row.type === "folder") {
          await store.renameFolder(row.id, folderId, name);
        } else {
          await store.renameFile(row.id, folderId, name);
        }
      } catch (error) {
        toast.error("Couldn't rename that", {
          description: errorMessage(error),
        });
      }
    },
    [folderId],
  );

  const onDelete = useCallback(
    (targets: BrowserRow[]) => {
      if (targets.length === 0) return;
      const entries = toEntries(targets);
      const subject =
        targets.length === 1
          ? (targets[0]?.name ?? "item")
          : pluralize(targets.length, "item");
      const { undo } = store.scheduleDelete(entries, folderId, (failures) => {
        if (failures.length === 0) return;
        toast.error(`Couldn't delete ${pluralize(failures.length, "item")}`, {
          description: failures[0]?.message,
        });
      });
      clearSelection();
      setFocusedId(null);

      // The delete is still only local until the window closes, so the toast
      // counts down rather than claiming it is already gone.
      const toastId = toast(`Deleting ${subject}`, {
        description: `${Math.round(UNDO_WINDOW_MS / 1000)}s to undo`,
        action: { label: "Undo", onClick: undo },
        duration: UNDO_WINDOW_MS,
      });
      const deadline = Date.now() + UNDO_WINDOW_MS;
      const tick = setInterval(() => {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        if (remaining <= 0) {
          clearInterval(tick);
          return;
        }
        toast(`Deleting ${subject}`, {
          id: toastId,
          description: `${remaining}s to undo`,
          action: { label: "Undo", onClick: undo },
          duration: remaining * 1000,
        });
      }, 1000);
      window.setTimeout(() => clearInterval(tick), UNDO_WINDOW_MS);
    },
    [clearSelection, folderId],
  );

  const runMove = useCallback(
    async (targets: BrowserRow[], targetFolderId: string) => {
      if (targets.length === 0 || targetFolderId === folderId) return;
      setMoving(true);
      const result = await store.move(
        toEntries(targets),
        folderId,
        targetFolderId,
      );
      setMoving(false);
      clearSelection();
      if (result.failures.length > 0) {
        toast.error(
          `Couldn't move ${pluralize(result.failures.length, "item")}`,
          {
            description: result.failures[0]?.message,
          },
        );
      } else if (result.moved > 0) {
        toast.success(`Moved ${pluralize(result.moved, "item")}`);
      }
    },
    [clearSelection, folderId],
  );

  const onDownload = useCallback(async (targets: BrowserRow[]) => {
    if (targets.length === 0) return;
    const single = targets[0];
    if (targets.length === 1 && single?.type === "file") {
      triggerDownload(api.url.fileDownload(single.id), single.name);
      return;
    }
    const knownBytes = targets.reduce(
      (total, row) => total + (row.sizeBytes ?? 0),
      0,
    );
    const warning = archiveSizeWarning(knownBytes);
    const toastId = toast.loading(warning ?? "Preparing your ZIP…");
    try {
      await downloadArchive(
        {
          fileIds: targets
            .filter((row) => row.type === "file")
            .map((row) => row.id),
          folderIds: targets
            .filter((row) => row.type === "folder")
            .map((row) => row.id),
        },
        ({ bytes }) =>
          toast.loading(`Preparing your ZIP — ${formatBytes(bytes)} so far`, {
            id: toastId,
          }),
      );
      toast.success("Your ZIP is ready", { id: toastId });
    } catch (error) {
      toast.error("Couldn't build that ZIP", {
        description: errorMessage(error),
        id: toastId,
      });
    }
  }, []);

  const controller: BrowserController = {
    // A folder cannot swallow itself or anything currently being dragged —
    // the server rejects it as CIRCULAR_MOVE, so refusing the drop outright
    // beats letting it land and reporting a failure.
    canDropInto: (targetId) => {
      if (targetId === folderId || selection.has(targetId)) return false;
      const drag = activeDrag();
      return !drag?.entries.some((entry) => entry.id === targetId);
    },
    focusedId,
    folderId,
    moving,
    onCancelRename: () => setRenamingId(null),
    onCommitRename: (row, name) => void onCommitRename(row, name),
    onDelete,
    onDownload: (targets) => void onDownload(targets),
    onDragEnd: endDrag,
    onDragStart: (row, event) => {
      const scope = scopeOf(row);
      beginDrag(event.dataTransfer, {
        entries: toEntries(scope),
        sourceFolderId: folderId,
      });
    },
    onDropInto: (targetFolderId, event) => {
      const payload = readDrop(event.dataTransfer);
      endDrag();
      if (!payload) return;
      const targets = payload.entries
        .map((entry) => rowsById.get(entry.id))
        .filter((row): row is BrowserRow => row !== undefined);
      void runMove(targets, targetFolderId);
    },
    onMove: (targets, targetFolderId) => void runMove(targets, targetFolderId),
    onOpen,
    onPointerSelect,
    onStartRename: setRenamingId,
    onToggleSelect,
    renamingId,
    scopeOf,
    selection,
  };

  const startUpload = useCallback(
    (files: { file: File; relativeDir: string }[]) => {
      if (files.length === 0 || !state.folder) return;
      uploads.add(files, folderId, state.folder.path);
    },
    [folderId, state.folder],
  );

  const onPaneDrop = async (event: DragEvent) => {
    dragDepth.current = 0;
    setDropActive(false);
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    startUpload(await readDataTransfer(event.dataTransfer));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (renamingId || creating || previewId) return;
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const index = focusedId
      ? rows.findIndex((row) => row.id === focusedId)
      : -1;
    const focusRow = (nextIndex: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, nextIndex))];
      if (!row) return;
      const rowIndex = rows.indexOf(row);
      setFocusedId(row.id);
      anchorIndex.current = rowIndex;
      if (!event.shiftKey) setSelection(new Set([row.id]));
      else setSelection((current) => new Set([...current, row.id]));
      // A windowed row is not in the DOM yet, so scrollIntoView would silently
      // do nothing; the computed offset works either way.
      rowWindow.scrollToIndex(rowIndex);
      paneRef.current
        ?.querySelector(`[data-row-id="${row.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusRow(index < 0 ? 0 : index - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusRow(rows.length - 1);
      return;
    }
    if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setSelection(new Set(rows.map((row) => row.id)));
      return;
    }
    if (event.key === "Escape") {
      clearSelection();
      setFocusedId(null);
      return;
    }
    if (event.key === "Enter") {
      const row = index >= 0 ? rows[index] : undefined;
      if (row) {
        event.preventDefault();
        onOpen(row);
      }
      return;
    }
    if (event.key === " ") {
      const row = index >= 0 ? rows[index] : undefined;
      if (row) {
        event.preventDefault();
        onToggleSelect(row);
      }
      return;
    }
    if (event.key === "F2") {
      const row = index >= 0 ? rows[index] : undefined;
      if (row) {
        event.preventDefault();
        setRenamingId(row.id);
      }
      return;
    }
    if (event.key === "Backspace" && state.folder?.parentId) {
      event.preventDefault();
      router.push(`/folders/${state.folder.parentId}`);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      onDelete(
        selectedRows.length > 0
          ? selectedRows
          : rows.filter((row) => row.id === focusedId),
      );
    }
  };

  const createFolder = async (name: string) => {
    setCreating(false);
    try {
      await store.createFolder(folderId, name);
    } catch (error) {
      toast.error("Couldn't create that folder", {
        description: errorMessage(error),
      });
    }
  };

  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragEnter={(event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        dragDepth.current += 1;
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropActive(false);
      }}
      onDrop={(event) => void onPaneDrop(event)}
      className="relative flex min-h-0 flex-1 flex-col outline-none"
    >
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) startUpload(readFileList(event.target.files));
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // Directory pickers are still vendor-prefixed everywhere.
        {...{ webkitdirectory: "" }}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) startUpload(readFileList(event.target.files));
          event.target.value = "";
        }}
      />

      {selection.size > 0 ? (
        <div className="sticky top-12 z-20 flex h-12 shrink-0 items-center gap-1 border-b bg-background px-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Clear selection"
            onClick={clearSelection}
          >
            <X className="size-4" />
          </Button>
          <span className="mr-2 text-sm font-medium">
            {pluralize(selection.size, "item")} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => void onDownload(selectedRows)}
          >
            <Download className="size-3.5" />
            <span className="hidden sm:inline">Download</span>
          </Button>
          <Popover open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8">
                <FolderInput className="size-3.5" />
                <span className="hidden sm:inline">Move</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <MovePicker
                entries={toEntries(selectedRows)}
                sourceFolderId={folderId}
                busy={moving}
                onMove={(targetFolderId) => {
                  setBulkMoveOpen(false);
                  void runMove(selectedRows, targetFolderId);
                }}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive"
            onClick={() => onDelete(selectedRows)}
          >
            <Trash2 className="size-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      ) : (
        <div className="sticky top-12 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
          <div className="min-w-0 flex-1 overflow-hidden">
            {state.folder && (
              <Breadcrumbs folder={state.folder} ancestors={state.ancestors} />
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Sort and view options"
              >
                <ArrowDownUp className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortKey}
                onValueChange={(value) => setSortKey(value as SortKey)}
              >
                {SORT_KEYS.map((key) => (
                  <DropdownMenuRadioItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sortDirection}
                onValueChange={(value) =>
                  setSortDirection(value as SortDirection)
                }
              >
                <DropdownMenuRadioItem value="asc">
                  Ascending
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">
                  Descending
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  setDensity(density === "compact" ? "comfortable" : "compact")
                }
              >
                <Rows3 className="size-3.5" />
                {density === "compact" ? "Comfortable rows" : "Compact rows"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={
              view === "grid" ? "Switch to list view" : "Switch to grid view"
            }
            onClick={() => setView(view === "grid" ? "list" : "grid")}
          >
            {view === "grid" ? (
              <List className="size-3.5" />
            ) : (
              <LayoutGrid className="size-3.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setCreating(true)}
          >
            <FolderPlus className="size-3.5" />
            <span className="hidden sm:inline">New folder</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-8">
                <Upload className="size-3.5" />
                <span className="hidden sm:inline">Upload</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => filesInputRef.current?.click()}>
                Upload files
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => folderInputRef.current?.click()}
              >
                Upload a folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div
        ref={scrollRef}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
      >
        {state.error && (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">{state.error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void store.reload(folderId)}
            >
              Try again
            </Button>
          </div>
        )}

        {!state.error && state.loading && rows.length === 0 && (
          <LoadingState view={view} />
        )}

        {!state.error && !state.loading && rows.length === 0 && !creating && (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
            <UploadCloud
              className="size-8 text-muted-foreground"
              strokeWidth={1.25}
            />
            <p className="text-sm text-muted-foreground">Empty</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => filesInputRef.current?.click()}
              >
                Upload files
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreating(true)}
              >
                New folder
              </Button>
            </div>
          </div>
        )}

        {(rows.length > 0 || creating) &&
          (view === "list" ? (
            // Auto layout, not table-fixed: the metadata columns drop out at
            // narrow widths and a fixed layout would keep reserving their
            // width. The name cell claims the slack via w-full/max-w-0.
            <table className="w-full">
              <thead className="sr-only">
                <tr>
                  <th>Select</th>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Last modified</th>
                  <th>Storage tier</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {creating && (
                  <tr className="border-b">
                    <td className="w-px pl-3 pr-2" />
                    <td className="w-full max-w-0 py-2 pr-3">
                      <InlineName
                        initial=""
                        kind="folder"
                        placeholder="New folder"
                        onCommit={(name) => void createFolder(name)}
                        onCancel={() => setCreating(false)}
                      />
                    </td>
                    <td colSpan={4} />
                  </tr>
                )}
                {rowWindow.padTopPx > 0 && (
                  <tr aria-hidden>
                    <td colSpan={6} style={{ height: rowWindow.padTopPx }} />
                  </tr>
                )}
                {rows.slice(rowWindow.start, rowWindow.end).map((row) => (
                  <ItemRow
                    key={row.id}
                    row={row}
                    controller={controller}
                    density={density}
                  />
                ))}
                {rowWindow.padBottomPx > 0 && (
                  <tr aria-hidden>
                    <td colSpan={6} style={{ height: rowWindow.padBottomPx }} />
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <ul
              className={cn(
                "grid gap-1 p-3",
                density === "compact"
                  ? "grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]"
                  : "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]",
              )}
            >
              {creating && (
                <li className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-3">
                  <FolderPlus
                    className="mt-4 size-9 text-muted-foreground"
                    strokeWidth={1.25}
                  />
                  <InlineName
                    className="w-full"
                    initial=""
                    kind="folder"
                    placeholder="New folder"
                    onCommit={(name) => void createFolder(name)}
                    onCancel={() => setCreating(false)}
                  />
                </li>
              )}
              {rowWindow.padTopPx > 0 && (
                <li
                  aria-hidden
                  className="col-span-full"
                  style={{ height: rowWindow.padTopPx }}
                />
              )}
              {rows.slice(rowWindow.start, rowWindow.end).map((row) => (
                <ItemTile
                  key={row.id}
                  row={row}
                  controller={controller}
                  density={density}
                />
              ))}
              {rowWindow.padBottomPx > 0 && (
                <li
                  aria-hidden
                  className="col-span-full"
                  style={{ height: rowWindow.padBottomPx }}
                />
              )}
            </ul>
          ))}

        {state.pagination &&
          state.pagination.page < state.pagination.totalPages && (
            <div className="flex justify-center p-4">
              <Button
                variant="outline"
                size="sm"
                disabled={state.loadingMore}
                onClick={() => void store.loadMore(folderId)}
              >
                {state.loadingMore
                  ? "Loading…"
                  : `Show more (${state.pagination.total - state.files.length} left)`}
              </Button>
            </div>
          )}
      </div>

      {dropActive && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-foreground/40 bg-background/80 backdrop-blur-[1px]">
          <p className="text-sm font-medium">
            Drop to upload to {state.folder?.name ?? "this folder"}
          </p>
        </div>
      )}

      {previewId && previewFiles.length > 0 && (
        <PreviewOverlay
          files={previewFiles}
          fileId={previewId}
          onSelect={openPreview}
          onClose={() => openPreview(null)}
        />
      )}
    </div>
  );
}

function LoadingState({ view }: { view: "grid" | "list" }) {
  const placeholders = Array.from({ length: 12 }, (_, index) => index);
  if (view === "list") {
    return (
      <div className="divide-y">
        {placeholders.map((index) => (
          <div key={index} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="size-4" />
            <Skeleton
              className="h-3.5 flex-1"
              style={{ maxWidth: `${40 + ((index * 13) % 40)}%` }}
            />
            <Skeleton className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1 p-3">
      {placeholders.map((index) => (
        <div key={index} className="flex flex-col items-center gap-2 p-3">
          <Skeleton className="mt-4 size-9" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  );
}
